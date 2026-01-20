# CG API Test Framework

A comprehensive API testing tool with Postman integration that allows you to manage projects, upload API specifications, run tests, and generate HTML reports.

## Features

- **Project Management**: Create and manage multiple projects/workspaces
- **API Specification Upload**: Upload OpenAPI YAML/JSON files or Postman collections
- **Test Execution**: Run selected tests using Newman CLI
- **HTML Reports**: Generate and export comprehensive test reports
- **Multi-Format Support**: Supports OpenAPI YAML, JSON, and Postman Collection formats

## Prerequisites

- Node.js (v14 or higher)
- PostgreSQL (v12 or higher)
- npm or yarn

## Installation

1. Clone the repository and navigate to the project directory

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

4. Update the `.env` file with your database credentials:
```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=qa_framework
DB_USER=postgres
DB_PASSWORD=your_password
```

5. Run database migrations:
```bash
npm run migrate
```

This will:
- Create the `qa_framework` database if it doesn't exist
- Create all necessary tables

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

**Verification scripts:**
- `scripts/run-sample-execution-with-delay.js` — creates a small two-request collection and runs it with a configured `delayBetweenTests` to validate delay timing.
- `scripts/create-test-run-fixture.js` — creates a synthetic test run (success + failure) and generates an HTML report for manual verification of report content (response bodies, errors).

## Project Structure

```
.
├── config/          # Database configuration
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

## Database Schema

The application uses PostgreSQL with the following main tables:
- `projects` - Project/workspace information
- `api_specs` - API specification files
- `collections` - Postman collections
- `project_api_specs` - Many-to-many relationship between projects and API specs
- `test_runs` - Test execution metadata
- `test_results` - Individual test results

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

## License

ISC

