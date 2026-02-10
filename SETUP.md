# Setup Instructions

This document describes how to set up and run the QA Test Hub: dependencies, Docker deployment, and local development.

---

## Dependencies and software (overview)

The application depends on the following. When using **Docker**, most are included in the image; when running **locally**, you must install them yourself.

| Software | Minimum version | Purpose | Docker image | Local |
|----------|------------------|---------|--------------|-------|
| **Node.js** | 18.x LTS | Runtime for the app and all runners | Yes (Node 20) | Required |
| **npm** | 8.x | Install packages and run scripts | Yes | Required |
| **PostgreSQL** | 12 | Database (projects, specs, runs, Playwright, fuzz, flows, schedules) | Separate container | Required |
| **Playwright** (npm) | 1.49+ | UI tests and recorded tests | Yes | Installed via `npm install` |
| **Playwright browsers** | — | Chromium (required for UI tests); Firefox & WebKit optional for multi-browser | Chromium only | `npx playwright install chromium` (or `chromium firefox webkit`) |
| **Newman** (npm) | 6.x | Postman collection execution (API tests) | Yes | Installed via `npm install` |
| **Java** | 17+ | CATS fuzz runs when using JAR | Yes (JRE headless) | Required only for CATS JAR |
| **CATS** | — | OpenAPI fuzz testing (Run Fuzz) | Yes (native binary) | Optional; JAR or binary — see [Installing CATS](#installing-cats) |
| **Xvfb** | — | Virtual display for headless Codegen | Yes | Not needed (use local display or Docker) |
| **x11vnc** | — | VNC server for remote Codegen | Yes | Not needed |
| **noVNC / websockify** | — | Browser-based VNC client for remote Codegen | Yes | Not needed |
| **Docker Engine** | 24+ | Running the app in containers | — | Only for Docker deployment |
| **Docker Compose** | v2 | Orchestrating app + DB | — | Only for Docker deployment |

**Summary for local development:** Install Node.js 18+, PostgreSQL 12+, run `npm install` and `npm run migrate`, then optionally install Playwright browsers and Java/CATS for UI and fuzz features. See [Local Development Setup](#local-development-setup-without-docker) below.

---

## Docker Deployment (Recommended for SaaS / Production)

This is the recommended deployment method for production servers and SaaS hosting. The Docker image includes all application dependencies: Node.js 20, PostgreSQL client libs, Playwright Chromium, Xvfb, x11vnc, noVNC/websockify (for remote test recording), Java (JRE headless), and the CATS native binary for fuzz runs. You do **not** need to set `CATS_CMD` when using Docker—the image has CATS installed.

### Prerequisites (Docker)

- **Docker Engine** 24+ ([Install Docker](https://docs.docker.com/engine/install/))
- **Docker Compose** v2 (included with Docker Desktop; on Linux: `apt install docker-compose-plugin`)

### Build and run

```bash
# 1. Create your environment file
cp .env.example .env

# 2. Edit .env — set DB_PASSWORD at minimum
#    Optionally adjust DB_NAME, CODEGEN_MAX_SESSIONS, etc.

# 3. Build and start the containers
docker compose up --build -d
# Database migrations run automatically when the app container starts (see scripts/docker-entry.sh).
# If you see schema errors (e.g. "column X does not exist"), run migrations manually:
#   docker compose exec app npm run migrate

# 4. Verify the app is running
curl http://localhost:3000/health
# Should return: {"status":"ok","timestamp":"..."}
```

The application is now available at **http://\<server-ip\>:3000**.

### Database migrations (Docker)

Migrations run automatically when the app container starts (`scripts/docker-entry.sh`). You do not need to run them manually for a normal first-time deploy or after `git pull` + rebuild.

If you see database schema errors (e.g. "column X of relation Y does not exist"), run migrations inside the app container:

```bash
docker compose exec app npm run migrate
```

### Ports

| Port | Service |
|---|---|
| `3000` | QA Test Hub web application |
| `5432` | PostgreSQL (optional; remove from docker-compose.yml if not needed externally) |
| `6080-6089` | noVNC WebSocket ports for remote Codegen sessions (one per concurrent session) |

Make sure ports 3000 and 6080-6089 are open in your VM's firewall.

### Remote Codegen configuration

When running in Docker, "Launch Codegen" automatically uses remote recording (Xvfb + noVNC). Users interact with a remote Chromium browser embedded in the app's UI — no software installation is needed on their laptops.

| Variable | Default | Description |
|---|---|---|
| `CODEGEN_MAX_SESSIONS` | `3` | Maximum concurrent remote Codegen sessions. Each session uses ~200-400MB RAM. |
| `CODEGEN_SESSION_TIMEOUT_MS` | `600000` | Auto-timeout per session in ms (default: 10 minutes) |
| `CODEGEN_VNC_PORT_START` | `6080` | First websockify port. Sessions use sequential ports: 6080, 6081, ... |

To change these, edit `.env` and restart:

```bash
docker compose down
docker compose up -d
```

### Updating the application

```bash
# Pull latest code, rebuild, and restart
git pull
docker compose up --build -d
# Migrations run automatically on app startup. To run them without restarting:
#   docker compose exec app npm run migrate
```

### Stopping

```bash
docker compose down          # stop containers (data persists in volume)
docker compose down -v       # stop and DELETE database volume (destructive!)
```

---

## Local Development Setup (without Docker)

Use this when developing on your local machine (Windows, macOS, or Linux with a desktop).

### Prerequisites (local)

Install the following before creating `.env` or running the app:

1. **Node.js** 18 or higher (LTS recommended) — [nodejs.org](https://nodejs.org/). Includes npm.
2. **PostgreSQL** 12 or higher — [postgresql.org](https://www.postgresql.org/download/). Ensure the server is running and you have a user and (optionally) an existing database; the migration script can create the database if it does not exist.
3. **(Optional) Playwright browsers** — Required only for **UI Tests**. After `npm install`, run:
   - `npx playwright install chromium` (minimum for UI tests)
   - Or `npx playwright install chromium firefox webkit` (all browsers)
4. **(Optional) Java 17+ and CATS** — Required only for **Run Fuzz**. See [Optional: REST API Fuzzing (CATS)](#5-optional-rest-api-fuzzing-cats) below.

All other application dependencies (Express, Newman, Playwright npm package, Sequelize, Handlebars, etc.) are installed with:

```bash
npm install
```

Run this in the project root before or after creating `.env`. See `package.json` for the full list.

### 1. Create .env File

Create a `.env` file in the root directory with the following content:

```env
# Database Configuration (set DB_NAME to your PostgreSQL database, e.g. linkuup_db or qa_framework)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=qa_framework
DB_USER=postgres
DB_PASSWORD=your_actual_password_here

# Server Configuration
PORT=3000
NODE_ENV=development

# File Upload Configuration
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=10485760

# Report Configuration
REPORTS_DIR=./reports

# Playwright / UI Tests (optional)
PLAYWRIGHT_BASE_URL=https://5gapisprint.meoempresas.pt/apis
PLAYWRIGHT_TIMEOUT_MS=30000
PLAYWRIGHT_HEADLESS=false

# REST API Fuzzing (optional) – only if you use Run Fuzz
# CATS_CMD=java -jar C:/tools/cats/cats-runner.jar

# Remote Codegen – not needed for local dev with a display; configure only for headless servers
# CODEGEN_MAX_SESSIONS=3
# CODEGEN_SESSION_TIMEOUT_MS=600000
# CODEGEN_VNC_PORT_START=6080
```

**Important**: Replace `your_actual_password_here` with your actual PostgreSQL password.

### 2. Run Database Migrations

After creating the `.env` file with your database credentials, run:

```bash
npm run migrate
```

This will:
- Create the database if it doesn't exist (name from `DB_NAME` in `.env`)
- Run all migration files in order, creating tables for projects, API specs, collections, test runs, Playwright runs/results/recorded tests, flows, schedules, SOAP, fuzz runs, and related schema

### 3. Start the Server

```bash
npm start
```

Or for development with auto-reload:

```bash
npm run dev
```

### 4. Optional: UI Tests (Playwright)

If you want to run UI tests from the **UI Tests** section:

1. Install Playwright browsers (required once per machine):
   ```bash
   npx playwright install chromium
   ```

2. In `.env` you can set (optional; defaults are in README):
   - `PLAYWRIGHT_BASE_URL` – default URL to test
   - `PLAYWRIGHT_TIMEOUT_MS` – timeout in ms (default: 30000)
   - `PLAYWRIGHT_HEADLESS` – `true` or `false` (default: true)

On local development with a display, "Launch Codegen" opens the Playwright Codegen window directly. On headless servers, it uses remote recording via noVNC (see Docker Deployment above).

See **Playwright / UI Tests** in [README.md](README.md) for running and recording UI tests.

### 5. Optional: REST API Fuzzing (CATS)

If you want to run **Fuzz** runs from a project (Run Fuzz), you must install CATS. Without it, a fuzz run will be created but will fail immediately with no results.

#### Prerequisites

- **Java 17 or newer** (required for the JAR). Check with `java -version`. Install from [Adoptium](https://adoptium.net/), [Oracle JDK](https://www.oracle.com/java/technologies/downloads/), or [sdkman.io](https://sdkman.io/jdks).

#### Installing CATS

**Option A – JAR (recommended on Windows)**

1. Go to [CATS releases](https://github.com/Endava/cats/releases) and download the latest **`cats-*-runner.jar`** (or `cats-*-uberjar.jar`) from Assets.
2. Save the JAR to a folder, e.g. `C:\tools\cats\cats-runner.jar`.
3. In your project `.env`, add (adjust the path to your JAR):
   ```env
   CATS_CMD=java -jar C:\tools\cats\cats-runner.jar
   ```
   If the path has spaces, use quotes: `CATS_CMD=java -jar "C:\Program Files\cats\cats-runner.jar"`.
4. Restart the app (`npm start`) so it picks up `CATS_CMD`.

**Option B – JAR on PATH (no .env)**

1. Download the JAR as in Option A.
2. Create a script that runs it, e.g. `cats.cmd` in a folder on your PATH:
   ```bat
   @echo off
   java -jar "C:\tools\cats\cats-runner.jar" %*
   ```
3. Do not set `CATS_CMD`; the app will use the `cats` command.

**Option C – macOS / Linux (native binary, no Java)**

1. On [releases](https://github.com/Endava/cats/releases), download the **native binary** for your OS.
2. Make it executable and put it on PATH:
   ```bash
   chmod +x cats-*-runner
   sudo mv cats-*-runner /usr/local/bin/cats
   ```
3. Do not set `CATS_CMD` (or set `CATS_CMD=cats`).

**Option D – macOS with Homebrew**

```bash
brew tap endava/tap
brew install cats
```

#### Verify installation

Run (adjust path if using JAR):

```bash
java -jar C:\tools\cats\cats-runner.jar --help
```

Or, if `cats` is on PATH: `cats --help`. You should see CATS usage.

#### Using fuzz runs in the app

Open a **project** → **Run Fuzz** → choose **API Spec** (OpenAPI YAML/JSON only), **Base URL**, and **Run name** → submit. Results appear under **Test Runs** (filter by type **Fuzz**); open a run to view the report.

---

## Troubleshooting

### Error: "client password must be a string"

This means the `DB_PASSWORD` in your `.env` file is either:
- Not set
- Set to an empty value
- Not properly formatted

**Solution**: Make sure your `.env` file has a valid password:
```env
DB_PASSWORD=your_password_here
```

If your password contains special characters, make sure to quote it or escape them properly.

### Error: "Connection refused"

This means PostgreSQL is not running or the connection details are incorrect.

**Solution**: 
- Make sure PostgreSQL is running
- Verify `DB_HOST`, `DB_PORT`, and `DB_USER` in your `.env` file
- Check that your PostgreSQL user has permission to create databases

### Fuzz run fails immediately or "CATS not found"

This means CATS is not installed or `CATS_CMD` is wrong.

**Solution**:
- Install Java 17+ and the CATS JAR (see [Installing CATS](#installing-cats) above).
- If using the JAR, set `CATS_CMD=java -jar <full-path-to-cats-runner.jar>` in `.env` (use forward slashes or escaped backslashes on Windows).
- Restart the app after changing `.env`.
- Verify with `java -jar <path-to-cats-runner.jar> --help` (or `cats --help` if on PATH).

### Codegen session fails to start (Docker)

Remote Codegen requires Xvfb, x11vnc, and websockify inside the container.

**Solution**:
- Ensure you are using the provided `Dockerfile` (it installs all required packages).
- Check container logs: `docker compose logs app`
- Look for errors like "Xvfb not found" or "x11vnc: command not found" — rebuild the image: `docker compose up --build -d`

### noVNC panel shows blank or "connection refused"

The noVNC iframe connects to a websockify port (6080+) on the server.

**Solution**:
- Check that ports 6080-6089 are mapped in `docker-compose.yml` and open in your VM's firewall
- Check that `CODEGEN_VNC_PORT_START` matches the port range in `docker-compose.yml`
- Inspect container logs: `docker compose logs app | grep codegen`

### Session times out too quickly

By default sessions auto-terminate after 10 minutes.

**Solution**: Increase `CODEGEN_SESSION_TIMEOUT_MS` in `.env`:
```env
CODEGEN_SESSION_TIMEOUT_MS=1200000   # 20 minutes
```
Then restart: `docker compose down && docker compose up -d`

### Maximum sessions reached

When all session slots are in use, new "Launch Codegen" requests will fail.

**Solution**:
- Wait for existing sessions to finish or time out
- Increase `CODEGEN_MAX_SESSIONS` in `.env` (ensure the port range in `docker-compose.yml` covers enough ports and your server has enough RAM)
