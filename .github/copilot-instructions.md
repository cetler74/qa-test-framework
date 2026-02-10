# CG API Test Framework - AI Agent Instructions

## Project Overview

**Purpose**: A web-based API testing platform that integrates Postman collections with automated test execution, reporting, and project management via PostgreSQL.

**Tech Stack**: Express.js, Sequelize (PostgreSQL), Newman (Postman CLI), Handlebars (HTML templates)

## Architecture & Data Flow

### Core Components

1. **Projects** (`models/Project.js`): Workspaces that organize test runs and API specifications
2. **API Specs** (`models/ApiSpec.js`): Uploaded OpenAPI (YAML/JSON) or Postman collections stored with spec_content (JSONB)
3. **Collections** (`models/Collection.js`): Postman collections generated/converted from API specs
4. **Test Runs** (`models/TestRun.js`): Execution records with pass/fail metrics and status
5. **Test Results** (`models/TestResult.js`): Individual test outcomes linked to test runs

### Data Relationships
- Projects ↔ ApiSpecs (many-to-many via `ProjectApiSpec` junction table)
- ApiSpecs → Collections (one-to-many, auto-generated)
- Projects → TestRuns (one-to-many)
- TestRuns → TestResults (one-to-many)

### Key Processing Flows

**Upload → Conversion → Execution → Reporting**:
1. File upload (`services/fileUpload.js`) validates format (YAML/JSON/Postman)
2. `apiSpecConverter.js` transforms OpenAPI to Postman Collection v2.1 (adds base_url variable, creates items from paths)
3. Multiple collections merged for a test run (`testRunner.js` → `mergeCollections()`)
4. Newman CLI executes merged collection with configurable per-test delays
5. Results stored in DB; HTML report generated (`services/reportGenerator.js` via Handlebars templates)

## Critical Patterns & Conventions

### Conversion Logic (`services/apiSpecConverter.js`)
- OpenAPI paths → Postman items with method/path/auth templates
- Base URL extracted from `servers[0].url` and stored as collection variable `base_url`
- BearerAuth security schemes auto-converted to Postman auth headers
- **Important**: Spec validation checks for `openapi` or `swagger` fields (required)

### Test Execution (`services/testRunner.js`)
- Collection merging: Items prefixed with source collection name to avoid conflicts
- Delay handling: Global delays run tests sequentially (one Newman invocation per test); per-test delays override global
- Variables conflict resolution: First occurrence of a variable key is retained across merged collections

### API Routes (`routes/api.js` - 579 lines)
- RESTful endpoints for Projects, ApiSpecs, Collections, TestRuns, TestResults
- Sequelize associations loaded eagerly via `include` to prevent N+1 queries
- Database constraints: Project name is unique, status field tracks test run state

### Database Configuration (`config/database.js`)
- Sequelize pool: max=5 connections, idle timeout=10s
- Database creation in migration script if missing
- Logging enabled only in development mode

## Developer Workflows

### Setup
```bash
npm install && cp .env.example .env  # Update DB_PASSWORD
npm run migrate                        # Create DB & tables
npm start                              # Dev: npm run dev (with nodemon)
```

### Database Migrations
- Migrations in `migrations/` run in alphabetical order (000_, 001_)
- Script `scripts/migrate.js` handles database creation + SQL execution
- Sequelize models must match migration schema (tables, columns, types)

### Key Scripts
- `npm run migrate`: Initialize database
- `scripts/generate-postman-tests.js`: Generate test scripts from Postman examples (infers types, validates status codes)
- `scripts/create-test-run-fixture.js`: Creates test data for report verification
- `scripts/run-sample-execution-with-delay.js`: Validates delay logic with two-request collection

## Common Modifications

### Adding API Endpoint Features
1. Update/add Sequelize model if schema changes needed
2. Add migration SQL file (increment prefix: `002_`, `003_`, etc.)
3. Update `models/index.js` associations if adding relationships
4. Add route handler in `routes/api.js` with eager-loaded includes

### Modifying Test Execution
- Collection merging logic: `testRunner.js` lines 20-75
- Per-test delay configuration: `testRunner.js` variable naming follows `delay_after_${index}`
- Report HTML template: `reportGenerator.js` inline template (embedded in file)

### Format Support Changes
- OpenAPI conversion: `apiSpecConverter.js` paths parsing (line ~60)
- New security schemes: Add to BearerAuth section (line ~100+)
- File type validation: `services/fileUpload.js` MIME type checks

## Error Patterns to Avoid

1. **Password handling**: `DB_PASSWORD` must be string (use `String()` wrapper), not undefined
2. **N+1 queries**: Always include associated models in Sequelize queries; omit unused associations
3. **Collection merging**: Variable deduplication uses `Set` to track keys (first wins)
4. **Missing migrations**: Model changes require corresponding SQL migration files
5. **Report generation**: Handlebars template expects `testRun` and `testResults` in context; missing fields cause template errors

## Environment Variables (Required)
```
DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
PORT (default 3000), NODE_ENV, UPLOAD_DIR, MAX_FILE_SIZE, REPORTS_DIR
```

## Testing & Validation
- Postman collection schemas must be v2.1 (checked in conversion)
- Test result parsing: Newman output mapped to TestResult model
- HTML reports: Use fixtures (`scripts/create-test-run-fixture.js`) for manual verification
