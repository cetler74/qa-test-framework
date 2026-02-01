# CG API Test Framework

A comprehensive API testing tool with Postman integration that allows you to manage projects, upload API specifications, run tests, and generate HTML reports.

## Features

- **Project Management**: Create and manage multiple projects/workspaces
- **API Specification Upload**: Upload OpenAPI YAML/JSON files or Postman collections
- **Test Execution**: Run selected tests using Newman CLI
- **HTML Reports**: Generate and export comprehensive test reports
- **Multi-Format Support**: Supports OpenAPI YAML, JSON, and Postman Collection formats
- **UI Tests (Playwright)**: Run browser-based UI tests (page load, key elements visible, basic navigation) against a configurable URL (e.g. 5gapisprint.meoempresas.pt/apis), with separate runs and HTML reports
- **REST API Fuzzing (CATS)**: Run OpenAPI-based fuzz tests via CATS (Contract API Testing Service); view fuzz runs and HTML reports alongside API, UI, and SOAP runs
- **Postman to OpenAPI**: Convert Postman collection JSON to OpenAPI 3.0 (Swagger) YAML for use with CATS, documentation, or other OpenAPI tools

## Prerequisites

- Node.js (v14 or higher)
- PostgreSQL (v12 or higher)
- npm or yarn
- **Java** (required for CATS CLI when using fuzz runs; see [SETUP.md](SETUP.md))

## Installation

1. Clone the repository and navigate to the project directory

2. Install dependencies and run migrations (complete build):
```bash
npm run build
```
Or separately: `npm install` then `npm run migrate`.

3. Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

4. Update the `.env` file with your database credentials (use your actual PostgreSQL database name; e.g. `linkuup_db` or `qa_framework`):
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=qa_framework
DB_USER=postgres
DB_PASSWORD=your_password
```

## Database Setup

### Initial Database Setup

The application requires PostgreSQL to be installed and running. Follow these steps to set up the database:

1. **Ensure PostgreSQL is running** on your system

2. **Configure database credentials** in your `.env` file (see Installation step 4 above)

3. **Run database migrations** to create the database and all required tables:
```bash
npm run migrate
```

Or manually:
```bash
node scripts/migrate.js
```

This migration script will:
- Connect to PostgreSQL using your `.env` credentials
- Create the `qa_framework` database if it doesn't exist
- Run all migration files in order:
  - `000_create_database.sql` - Database creation (handled automatically)
  - `001_create_tables.sql` - Creates all base tables (projects, api_specs, collections, test_runs, test_results, etc.)
  - `002_add_execution_order_and_test_id.sql` - Adds execution order and test ID tracking columns
  - `003_playwright_tables.sql` - Creates playwright_runs and playwright_results for UI tests
  - `004_playwright_recorded_tests.sql` - Creates playwright_recorded_tests for recorded Codegen specs
  - `005_project_scoped_ui_tests.sql` - Adds project_id to playwright_runs and project_recorded_tests junction table
  - `006_flows.sql` - Flows and flow_tasks
  - `007_schedules.sql` - Schedules
  - `008_soap_support.sql` - SOAP operations and run_type on test_runs
  - `009_fuzz_runs.sql` - fuzz_runs and fuzz_results for REST API fuzzing (CATS)

### Migration Files

The `migrations/` directory contains SQL migration files that are executed in alphabetical order:

- **000_create_database.sql** - Database creation instructions (handled by migration script)
- **001_create_tables.sql** - Creates all base tables and indexes
- **002_add_execution_order_and_test_id.sql** - Adds `execution_order` and `test_id` columns to `test_results` table for test ordering and identification
- **003_playwright_tables.sql** - Creates `playwright_runs` and `playwright_results` for UI test runs
- **004_playwright_recorded_tests.sql** - Creates `playwright_recorded_tests` for saved Codegen specs
- **005_project_scoped_ui_tests.sql** - Adds `project_id` to playwright_runs and creates `project_recorded_tests` junction table
- **006_flows.sql** - Flows and flow_tasks
- **007_schedules.sql** - Schedules
- **008_soap_support.sql** - SOAP operations and run_type
- **009_fuzz_runs.sql** - `fuzz_runs` and `fuzz_results` for REST API fuzzing (CATS)

### Manual Database Setup (Alternative)

If you prefer to set up the database manually:

1. **Create the database**:
```sql
CREATE DATABASE qa_framework;
```

2. **Connect to the database**:
```bash
psql -U postgres -d qa_framework
```

3. **Run migration files** in order:
```sql
\i migrations/001_create_tables.sql
\i migrations/002_add_execution_order_and_test_id.sql
\i migrations/003_playwright_tables.sql
\i migrations/004_playwright_recorded_tests.sql
\i migrations/005_project_scoped_ui_tests.sql
```

### Database Schema

The application uses the following main tables:

- **projects** - Project/workspace information
- **api_specs** - API specification files (OpenAPI YAML/JSON)
- **collections** - Postman collections
- **project_api_specs** - Many-to-many relationship between projects and API specs
- **test_runs** - Test execution metadata (name, status, counts, duration)
- **test_results** - Individual test results with:
  - Test execution details (name, endpoint, method, status)
  - Request/response bodies
  - Assertions and error messages
  - `execution_order` - Preserves the order tests were executed
  - `test_id` - Unique identifier for each test (e.g., TEST-1, TEST-2)

### Troubleshooting Database Issues

**Error: "column execution_order does not exist"**
- Solution: Run the migration script to add the new columns:
  ```bash
  npm run migrate
  ```

**Error: "client password must be a string"**
- Solution: Ensure `DB_PASSWORD` in your `.env` file is set and not empty

**Error: "Connection refused"**
- Solution: Verify PostgreSQL is running and check `DB_HOST`, `DB_PORT`, and `DB_USER` in your `.env` file

**Error: "database does not exist"**
- Solution: The migration script should create it automatically. If not, create it manually:
  ```sql
  CREATE DATABASE qa_framework;
  ```

## Running the Application

Start the server:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

The application will be available at `http://localhost:3000`

## Usage

1. **Create a Project**: Navigate to Projects and create a new project/workspace

2. **Upload API Specifications**: 
   - Go to API Specs
   - Upload YAML or JSON OpenAPI specification files
   - The system will automatically convert them to Postman collections

3. **Add API Specs to Project**:
   - Open your project
   - Click "Add API Spec" to add API specifications from the library

4. **Run Tests**:
   - In your project, click "Run Tests"
   - Select which tests to run
   - Provide a test run name (e.g., "Release 1.0")
   - Optionally configure delays:
     - **Global Delay**: set "Delay between tests (seconds)" — the runner will wait this many seconds before starting the next test.
     - **Per-test Delay**: each test row includes a "Delay s" input to specify seconds to wait *after* that specific test; per-test delays override the global delay for that transition.
     - Delays accept numbers (seconds); fractional values (e.g., 0.5) are supported. A value of 0 disables delay.
   - Click "Run Tests"

**Delay behavior notes:**
- When delays are present the runner executes tests **sequentially** (each test runs as its own Newman invocation), and waits the configured seconds before the next test. The total test run duration includes delays.
- Use per-test delays when you need custom wait times between specific consecutive tests; otherwise use the global delay for a consistent pause between tests.

5. **View Reports**:
   - Go to Test Runs to see all test executions
   - Click on a test run to view details
   - Click "View Report" to see the HTML report in a new window
   - Click "Download Report" to download the report as an HTML file

### REST API Fuzzing (Fuzz runs)

Fuzz runs use [CATS](https://github.com/Endava/cats) (Contract API Testing Service) to test your OpenAPI endpoints with generated and boundary inputs. From a project, click **Run Fuzz**, select an **API Spec** (OpenAPI YAML/JSON only), enter the **Base URL** (server URL for CATS), and a **Run name**. Fuzz runs appear in **Test Runs** with the **Fuzz** badge; open a run for details and use **View Report** / **Download Report** for the HTML report.

**Installing CATS:** You need Java 17+ and the CATS JAR (or native binary on macOS/Linux). See [SETUP.md – Installing CATS](SETUP.md#5-optional-rest-api-fuzzing-cats) for step-by-step instructions (download JAR, set `CATS_CMD` in `.env`, verify). Without CATS installed, "Run Fuzz" will create a run that immediately fails with no results.

**Verification scripts:**
- `scripts/run-sample-execution-with-delay.js` — creates a small two-request collection and runs it with a configured `delayBetweenTests` to validate delay timing.
- `scripts/create-test-run-fixture.js` — creates a synthetic test run (success + failure) and generates an HTML report for manual verification of report content (response bodies, errors).

### Converting Postman collections to OpenAPI (Swagger) YAML

You can convert a Postman collection (JSON) to OpenAPI 3.0 YAML for use with CATS fuzzing, Swagger UI, or other OpenAPI-based tools.

**What the converter does:**
- Walks all requests in the collection (including nested folders)
- Builds OpenAPI paths, operations, and parameters from method, URL, headers, query, and body
- Uses collection `info` and variables (e.g. `base_url`) for `info` and `servers`
- Adds Bearer auth in `components.securitySchemes` when used in request headers
- Writes standard OpenAPI 3.0 YAML

**Usage:**

```bash
# Output path optional; if omitted, writes <collection-name>.openapi.yaml next to the JSON
node scripts/postman-to-swagger.js <postman-collection.json> [output.yaml]
```

Or via npm:

```bash
npm run postman-to-swagger -- "path/to/collection.postman_collection.json" "output.openapi.yaml"
```

**Example** (convert the CAMARA Tests collection):

```bash
npm run postman-to-swagger -- "SmartAPI-CAMARA R2.0.0 - Tests.postman_collection.json" "SmartAPI-CAMARA-R2.0.0-Tests.openapi.yaml"
```

The script supports Postman collection v2.0 and v2.1. The generated YAML can be uploaded as an API spec in the app or used with CATS, Swagger Editor, or any OpenAPI 3.0 tool.

### Playwright / UI Tests

UI tests run in a separate **UI Tests** section (nav: "UI Tests"). They target a configurable base URL and execute: page load, key elements visible, and basic navigation.

**Setup:**

1. Install dependencies (Playwright is included):  
   `npm install`

2. Install Playwright browser (required once per machine or CI):  
   `npx playwright install chromium`

3. Optional: in `.env` set:
   - `PLAYWRIGHT_BASE_URL` – default URL to test (e.g. `https://5gapisprint.meoempresas.pt/apis`)
   - `PLAYWRIGHT_TIMEOUT_MS` – timeout in ms (default: 30000)
   - `PLAYWRIGHT_HEADLESS` – `true` or `false` (default: true)

**From the app:** Open **UI Tests**, click **Run UI Tests**, enter a run name and optionally override the base URL, then Run. View list, open a run for details, and use **View Report** / **Download Report** for the HTML report.

**From the CLI:**  
`npm run test:playwright`  
This runs the same suite using the default base URL from config and stores results in the database.

**Recorded UI tests:** You can define extra test cases by recording browser interactions with Playwright Codegen and saving them in the app.

1. In the app go to **UI Tests** → **Add recorded test** (or **Manage recorded tests**).
2. In a terminal run: `npx playwright codegen <your-url>` (use the same base URL you test against). Perform the actions you want to test; the Playwright Inspector will show generated test code.
3. Copy the generated code from the Inspector and paste it into the **Generated spec** field. Enter a **Test name** and optionally a **Base URL**, then click **Save**.
4. Recorded tests appear in the test list when you click **Run UI Tests** (they are listed as "Recorded: &lt;name&gt;"). You can run them alone or together with the built-in tests.
5. Use **Manage recorded tests** to edit or delete saved recordings.

Note: "Launch Codegen" from the app (if added) requires a display (e.g. local or dev environment); on headless servers use the paste-and-save flow above.

## Project Structure

```
.
├── config/          # Database and Playwright configuration (database.js, playwright.js)
├── e2e/             # Playwright E2E tests (recorded specs in e2e/recorded/, config in ui-tests.config.js)
├── migrations/      # Database migration scripts
├── models/          # Sequelize models
├── public/          # Frontend files (HTML, CSS, JS)
├── routes/          # Express routes
├── scripts/         # Utility scripts
├── services/        # Business logic services
├── server.js        # Application entry point
└── package.json     # Dependencies and scripts
```

## API Endpoints

### Projects
- `GET /api/projects` - List all projects
- `POST /api/projects` - Create a project
- `GET /api/projects/:id` - Get project details
- `PUT /api/projects/:id` - Update project
- `DELETE /api/projects/:id` - Delete project

### API Specifications
- `GET /api/api-specs` - List all API specs
- `POST /api/api-specs/upload` - Upload API spec file
- `GET /api/api-specs/:id` - Get API spec details
- `DELETE /api/api-specs/:id` - Delete API spec

### Collections
- `GET /api/collections` - List all collections
- `GET /api/projects/:projectId/collections` - Get collections for a project
- `POST /api/collections/upload` - Upload Postman collection

### Test Runs
- `GET /api/test-runs` - List test runs
- `POST /api/test-runs/execute` - Execute tests (supports optional `delayBetweenTests` in seconds and `testDelays` mapping for per-test delays in seconds)
- `GET /api/test-runs/:id` - Get test run details
- `POST /api/test-runs/:id/report` - Generate HTML report
- `GET /api/test-runs/:id/report/download` - Download report

### Fuzz Runs (REST API Fuzzing with CATS)
- `POST /api/fuzz-runs/execute` - Start a fuzz run (body: `projectId`, `apiSpecId`, `name`, `serverUrl`; optional: `flowId`, `paths`, `skipPaths`)
- `GET /api/fuzz-runs` - List fuzz runs (query: `projectId`, `limit`, `offset`)
- `GET /api/fuzz-runs/:id` - Get fuzz run with results
- `GET /api/fuzz-runs/:id/report` - HTML report
- `GET /api/fuzz-runs/:id/report/download` - Download report
- `DELETE /api/fuzz-runs/:id` - Delete fuzz run

### Playwright / UI Tests
- `GET /api/playwright-config` - Get default base URL for UI
- `GET /api/playwright-tests/list` - List all tests (built-in + recorded)
- `POST /api/playwright-runs/execute` - Start a UI test run (body: `name`, optional `baseUrl`, `suite`, optional `selectedTestIds` for "selected" suite)
- `GET /api/playwright-runs` - List UI test runs
- `GET /api/playwright-runs/:id` - Get run with results
- `GET /api/playwright-runs/:id/report` - HTML report
- `GET /api/playwright-runs/:id/report/download` - Download report
- `DELETE /api/playwright-runs/:id` - Delete run

### Playwright recorded tests (Codegen paste-and-save)
- `GET /api/playwright-recorded-tests` - List recorded tests
- `POST /api/playwright-recorded-tests` - Create (body: `name`, `spec_content`, optional `base_url`)
- `GET /api/playwright-recorded-tests/:id` - Get one recorded test
- `PUT /api/playwright-recorded-tests/:id` - Update (body: optional `name`, `spec_content`, `base_url`)
- `DELETE /api/playwright-recorded-tests/:id` - Delete
- `POST /api/playwright-recorded-tests/launch-codegen` - Launch Playwright Codegen (optional; requires display; body: optional `baseUrl`)

## Database Schema

The application uses PostgreSQL with the following main tables:

- **projects** - Project/workspace information
  - `id`, `name`, `description`, `created_at`, `updated_at`

- **api_specs** - API specification files (OpenAPI YAML/JSON)
  - `id`, `name`, `description`, `format`, `file_path`, `spec_content`, etc.

- **collections** - Postman collections
  - `id`, `name`, `version`, `collection_json`, `api_spec_id`

- **project_api_specs** - Many-to-many relationship between projects and API specs
  - `id`, `project_id`, `api_spec_id`, `added_at`

- **test_runs** - Test execution metadata
  - `id`, `name`, `status`, `project_id`, `total_tests`, `passed_tests`, `failed_tests`, `duration_ms`, `created_at`

- **test_results** - Individual test results
  - `id`, `test_run_id`, `test_name`, `endpoint`, `method`, `status`
  - `duration_ms`, `request_body`, `response_body`, `response_code`
  - `assertions` (JSONB), `error_message`, `api_spec_id`
  - `execution_order` - Preserves the order tests were executed (added in migration 002)
  - `test_id` - Unique identifier for each test, e.g., TEST-1, TEST-2 (added in migration 002)
  - `created_at`

- **playwright_runs** - UI test run metadata (migration 003; migration 005 adds `project_id`)
  - `id`, `name`, `status`, `base_url`, `total_tests`, `passed_tests`, `failed_tests`, `duration_ms`, `project_id`, `created_at`

- **playwright_results** - Individual UI test results (migration 003)
  - `id`, `playwright_run_id`, `test_name`, `status`, `duration_ms`, `error_message`, `created_at`

- **playwright_recorded_tests** - Saved Codegen specs (migration 004)
  - `id`, `name`, `spec_content`, `base_url`, `created_at`, `updated_at`

- **project_recorded_tests** - Many-to-many: projects ↔ recorded UI tests (migration 005)
  - `id`, `project_id`, `recorded_test_id`, `added_at`

- **fuzz_runs** - Fuzz run metadata (migration 009)
  - `id`, `name`, `status`, `project_id`, `api_spec_id`, `flow_id`, `total_tests`, `passed_tests`, `failed_tests`, `duration_ms`, `report_path`, `created_at`

- **fuzz_results** - Individual fuzz test results (migration 009)
  - `id`, `fuzz_run_id`, `test_name`, `endpoint`, `method`, `status`, `duration_ms`, `request_body`, `response_body`, `response_code`, `fuzzer_name`, `error_message`, `execution_order`, `created_at`

## Environment Variables

- `DB_HOST` - PostgreSQL host (default: localhost)
- `DB_PORT` - PostgreSQL port (default: 5432)
- `DB_NAME` - Database name (default: qa_framework)
- `DB_USER` - Database user (default: postgres)
- `DB_PASSWORD` - Database password
- `PORT` - Server port (default: 3000)
- `UPLOAD_DIR` - Directory for uploaded files (default: ./uploads)
- `REPORTS_DIR` - Directory for generated reports (default: ./reports)
- `MAX_FILE_SIZE` - Maximum upload file size in bytes (default: 10485760)
- `PLAYWRIGHT_BASE_URL` - Default URL for UI tests (e.g. https://5gapisprint.meoempresas.pt/apis)
- `PLAYWRIGHT_TIMEOUT_MS` - Timeout for Playwright actions in ms (default: 30000)
- `PLAYWRIGHT_HEADLESS` - Run browser headless: true or false (default: true)
- `CATS_CMD` - Optional; CATS CLI command (e.g. `cats` or `java -jar /path/to/cats.jar`) when not on PATH

## License

ISC

