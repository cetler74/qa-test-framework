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

## API

**POST /verify**

Request body: `{ "username": "string", "password": "string" }`

- **200**: Authentication succeeded. Body: `{ "display_name": "string" }` (currently the username).
- **400**: Missing username or password.
- **401**: Authentication failed.

## Security

- Run the proxy on the same host as Docker or in a trusted network.
- Use HTTPS for `PAM_AUTH_URL` in production if the proxy is on another machine.
- The proxy receives plaintext passwords; keep the channel to the app secure (localhost or private network).
