# Setup Instructions

## 1. Create .env File

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
PLAYWRIGHT_HEADLESS=true

# REST API Fuzzing (optional) – only if you use Run Fuzz
# CATS_CMD=java -jar C:/tools/cats/cats-runner.jar
```

**Important**: Replace `your_actual_password_here` with your actual PostgreSQL password.

## 2. Run Database Migrations

After creating the `.env` file with your database credentials, run:

```bash
npm run migrate
```

This will:
- Create the database if it doesn't exist (name from `DB_NAME` in `.env`)
- Create all necessary tables (including `playwright_runs`, `playwright_results`, `playwright_recorded_tests` for UI tests, and `fuzz_runs`, `fuzz_results` for REST API fuzzing when migration `009_fuzz_runs.sql` is present)

## 3. Start the Server

```bash
npm start
```

Or for development with auto-reload:

```bash
npm run dev
```

## 4. Optional: UI Tests (Playwright)

If you want to run UI tests from the **UI Tests** section:

1. Install Playwright browsers (required once per machine):
   ```bash
   npx playwright install chromium
   ```

2. In `.env` you can set (optional; defaults are in README):
   - `PLAYWRIGHT_BASE_URL` – default URL to test
   - `PLAYWRIGHT_TIMEOUT_MS` – timeout in ms (default: 30000)
   - `PLAYWRIGHT_HEADLESS` – `true` or `false` (default: true)

See **Playwright / UI Tests** in [README.md](README.md) for running and recording UI tests.

## 5. Optional: REST API Fuzzing (CATS)

If you want to run **Fuzz** runs from a project (Run Fuzz), you must install CATS. Without it, a fuzz run will be created but will fail immediately with no results.

### Prerequisites

- **Java 17 or newer** (required for the JAR). Check with `java -version`. Install from [Adoptium](https://adoptium.net/), [Oracle JDK](https://www.oracle.com/java/technologies/downloads/), or [sdkman.io](https://sdkman.io/jdks).

### Installing CATS

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

### Verify installation

Run (adjust path if using JAR):

```bash
java -jar C:\tools\cats\cats-runner.jar --help
```

Or, if `cats` is on PATH: `cats --help`. You should see CATS usage.

### Using fuzz runs in the app

Open a **project** → **Run Fuzz** → choose **API Spec** (OpenAPI YAML/JSON only), **Base URL**, and **Run name** → submit. Results appear under **Test Runs** (filter by type **Fuzz**); open a run to view the report.

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
- Install Java 17+ and the CATS JAR (see [Installing CATS](#5-optional-rest-api-fuzzing-cats) above).
- If using the JAR, set `CATS_CMD=java -jar <full-path-to-cats-runner.jar>` in `.env` (use forward slashes or escaped backslashes on Windows).
- Restart the app after changing `.env`.
- Verify with `java -jar <path-to-cats-runner.jar> --help` (or `cats --help` if on PATH).

