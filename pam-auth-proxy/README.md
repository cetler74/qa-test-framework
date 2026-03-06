# PAM Auth Proxy

Small HTTP service that verifies Linux OS user credentials using PAM. Used by the QA Test Hub when the app runs in **Docker**: the app cannot use PAM directly inside the container, so it calls this proxy running on the **host**.

## Requirements

- **Linux** (PAM is not available on Windows/macOS)
- Node.js 14+
- System PAM dev headers (for building `authenticate-pam`):
  - Debian/Ubuntu: `apt-get install libpam0g-dev`
  - RHEL/CentOS: `yum install pam-devel`

## Install and run

```bash
cd pam-auth-proxy
npm install
npm start
```

Defaults: listen on `0.0.0.0:9090`. The QA Test Hub app should be configured with:

- `ENABLE_PAM_AUTH=true`
- `PAM_AUTH_URL` — see below.

**PAM_AUTH_URL — what to use**

The app (running in Docker) must call this proxy over HTTP. From inside a container you need a URL that reaches the **host** where the proxy runs.

- **Windows or Mac (Docker Desktop):** Use `PAM_AUTH_URL=http://host.docker.internal:9090`. Docker Desktop provides the hostname `host.docker.internal`, which resolves to the host machine from inside any container.
- **Linux server:** Docker on Linux does **not** provide `host.docker.internal` by default. Use one of:
  - **Host IP:** Set `PAM_AUTH_URL=http://<host-ip>:9090` where `<host-ip>` is the server’s IP that the container can reach (e.g. `10.0.0.5`, `192.168.1.100`).
  - **Same as Docker Desktop:** In `docker-compose.yml`, add to the app service:
    ```yaml
    extra_hosts:
      - "host.docker.internal:host-gateway"
    ```
    Then set `PAM_AUTH_URL=http://host.docker.internal:9090`. (Requires Docker 20.10+.)

## Environment

| Variable         | Default  | Description                          |
|-----------------|----------|--------------------------------------|
| `PORT`          | 9090     | Port to listen on                    |
| `PAM_SERVICE`   | login    | PAM service name (e.g. `/etc/pam.d/login`) |
| `PAM_REMOTE_HOST` | —      | Optional; set for network auth (e.g. `localhost`) |

### PAM service name and `/etc/pam.d/<service>`

The application must be **PAM‑aware** and use a **dedicated PAM service name** (e.g. `qa-auth`). Set `PAM_SERVICE=qa-auth` so the proxy uses `/etc/pam.d/qa-auth`. That file must exist and define an auth stack that can see your users (local and/or LDAP/SSSD).

Example `/etc/pam.d/qa-auth` for local + environment:

```
auth     required   pam_env.so
auth     sufficient pam_unix.so nullok
account  required   pam_unix.so
session  required   pam_unix.so
```

If users are in LDAP/AD, include the appropriate module (e.g. `pam_sss.so` or `pam_ldap.so`) in the auth stack instead of or in addition to `pam_unix.so`, and ensure NSS resolves them (see Debugging below).

## API

**POST /verify**

Request body: `{ "username": "string", "password": "string" }`

- **200**: Authentication succeeded. Body: `{ "display_name": "string" }` (currently the username).
- **400**: Missing username or password.
- **401**: Authentication failed.

## Security

- Run the proxy on the same host as Docker or in a trusted network.
- The proxy receives plaintext passwords; keep the channel to the app secure (localhost or private network).
- Use HTTPS for `PAM_AUTH_URL` in production if the proxy is on another machine.

### Running as root or via a privileged helper (required for arbitrary users)

The log messages `check pass; user unknown` and `password check failed for user (…)` come from PAM’s **unix_chkpwd** helper. That helper only allows a process to re‑authenticate the **same** user as the process’s real UID. It does **not** allow a non‑root process to check another user’s password (e.g. a service running as `qa-app` cannot verify `tm043551`).

So for the proxy to authenticate **arbitrary** OS users (not just the user running the proxy), you must either:

1. **Run the proxy as root**  
   Example: `sudo npm start`, or a systemd unit with `User=root`. Easiest for testing; acceptable for a dedicated host if you harden the rest (firewall, no other services).

2. **Use a setuid‑root helper**  
   Implement a small C (or other) program that:
   - Is owned by root and has the setuid bit (`chmod u+s`).
   - Accepts username and password (e.g. via stdin or carefully sanitized argv).
   - Calls `pam_start`, `pam_authenticate`, `pam_end` with your PAM service name.
   - Returns exit code 0 (success) or 1 (failure) and **does nothing else** (no shell, no extra privileges).
   - The Node proxy then runs as a normal user and invokes this helper (e.g. via `child_process.spawn`) and interprets the exit code.

Also ensure:

- The OS user is visible to NSS: `getent passwd <username>` must return the user (local, LDAP, or SSSD).
- Your PAM service (e.g. `/etc/pam.d/qa-auth`) includes the right modules: **pam_unix.so** for local users; **pam_sss.so** or **pam_ldap.so** if users are in LDAP/AD, so that PAM can resolve and authenticate them.

### Debugging (when you see "user unknown" / "password check failed")

On the server:

1. **PAM service** — Inspect the config for the service name the proxy uses (from `PAM_SERVICE`, e.g. `qa-auth`):  
   `cat /etc/pam.d/qa-auth`  
   Confirm it has `pam_unix.so` and, if users are in LDAP, `pam_sss.so` or `pam_ldap.so` as appropriate.

2. **User visible to NSS** — The OS user must be resolvable:  
   `getent passwd tm043551`  
   If this fails, the user is not in the system user DB (local, LDAP, or SSSD); fix NSS/SSSD/LDAP first.

3. **Test PAM as root** — Verify that PAM auth works for that user when run as root, e.g. with **pamtester** (if available):  
   `pamtester qa-auth tm043551 authenticate`  
   (enter the password when prompted). If this succeeds but the proxy still fails, the cause is almost certainly that the proxy runs as non‑root; run the proxy as root or use a setuid helper as above.
