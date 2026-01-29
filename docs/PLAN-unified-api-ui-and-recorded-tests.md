# Unified API and UI Test Structure (with Recorded Tests)

This plan extends the unified API/UI test structure to include **Record a test** (Playwright Codegen paste-and-save), **Add recorded test**, and **Manage recorded tests**, and defines where they live: in the project or as an overall section with recordings selectable per project.

---

## Part 1: Unified API and UI Test Structure (summary)

- **Database**: Add `project_id` to `playwright_runs` and (see Part 2) decide schema for recorded tests.
- **Backend**: Unified GET test-runs (API + UI) with `runType` and filters; POST playwright-runs/execute with `projectId`.
- **Frontend**: Test Runs view shows unified list with type badge (API/UI) and type filter; project detail has "Run API tests" and "Run UI Test"; detail navigation by `runType` + id.

---

## Part 2: Record a test / Add recorded test / Manage recorded tests

### Current behavior

- **Record a test**: Copy in [public/index.html](public/index.html) (e.g. lines 203–208): "Define a test by recording browser actions with Playwright Codegen, then paste the generated code here."
- **Add recorded test**: Opens the Add/Edit recorded test view (Codegen URL, name, base URL, paste spec).
- **Manage recorded tests**: Opens the recorded tests list view (list, edit, delete).
- Today these live under the **UI Tests** nav; recorded tests are global (no project), and Run UI Tests uses the full global list.

### Requirement

- Include **Record a test**, **Add recorded test**, and **Manage recorded tests** in the unified model.
- Either:
  - **A)** All in the **project** (recorded tests belong to a project; manage them inside the project), or
  - **B)** An **overall section** (global pool of recordings) where each project **selects** which recorded tests it uses (like API specs: global pool, project links to a subset).

### Recommendation: Overall section + project selection (Option B)

**Why it makes more sense**

- Reuse: the same recorded test (e.g. "Login flow", "Check dashboard") can be used in **multiple projects** without duplicating the spec.
- Mirrors existing pattern: **API specs** are global; **projects** link to them via `project_api_specs`. Same pattern for recorded tests keeps the model consistent.
- One place to maintain recordings: add/edit/delete in the global pool; per project you only "add/remove which recorded tests are in this project."

**Model**

- **Global pool**: Keep `playwright_recorded_tests` as the single source of recorded tests (no `project_id` on the table, or optional "created in context of" for display only).
- **Project selection**: Add junction table **`project_recorded_tests`** (`project_id`, `recorded_test_id`), unique on `(project_id, recorded_test_id)`, with `ON DELETE CASCADE` for both FKs. So:
  - A project has many recorded tests (those linked in `project_recorded_tests`).
  - A recorded test can be linked to many projects.
- **Run UI Test** for a project: only run recorded tests that are **linked to that project** (i.e. in `project_recorded_tests` for that `project_id`). GET `/playwright-tests/list?projectId=X` returns only recorded tests linked to project X.

**Where things live in the UI**

1. **Overall section – "UI Tests" (or "Recorded tests")**
   - **Record a test**: Keep the existing block: "Define a test by recording browser actions with Playwright Codegen, then paste the generated code here."
   - **Add recorded test**: Same as today (global add). Optionally: "Also add to project: [dropdown]"; if selected, create the recorded test and insert into `project_recorded_tests` for that project.
   - **Manage recorded tests**: List **all** recorded tests (global pool). Add, edit, delete. No project filter here; this is the master list. Optionally show "Used in projects: P1, P2" per row.
   - **Run UI Tests**: From here, require **project selector** (dropdown). User picks project, then chooses run name, base URL, and which of **that project’s** recorded tests to run (full list or selected). Submit with `projectId`.

2. **Inside a project (project detail view)**
   - **Manage recorded tests for this project**: New action (e.g. "Manage UI recorded tests" or "Recorded tests in project"). Opens a view/modal that:
     - Lists only the **recorded tests currently linked to this project**.
     - Allows **Add to project**: pick from the global pool (recorded tests not yet in this project) and add link (`project_recorded_tests`).
     - Allows **Remove from project**: remove link for this project (do not delete the global recorded test).
     - Optional: **Add new recorded test** (creates in global pool and adds to this project in one step).
   - **Run UI Test**: From project, "Run UI Test" uses current project; run only recorded tests linked to this project (as above).

So:

- **Record a test / Add recorded test / Manage recorded tests (global)** → overall **UI Tests** (or Recorded tests) section.
- **Manage recorded tests for this project** (select which global recordings are in the project) → **project detail**.
- **Run UI Test** → from project (with current project) or from overall section (with project dropdown).

### Alternative: Per-project only (Option A)

If you prefer **no global pool**:

- Add `project_id` (required) to `playwright_recorded_tests`. Each recorded test belongs to exactly one project.
- **Record a test / Add recorded test / Manage recorded tests** live **inside the project**: when you’re in a project, "Add recorded test" and "Manage recorded tests" only show that project’s tests. No junction table.
- **UI Tests** nav can still have an overall "Recorded tests" that shows all recordings across projects with a project filter, or you remove the global list and only allow management from within each project.

Option A is simpler (no junction table, no "add to project" from global list) but does not allow reusing the same recording in multiple projects.

---

## Part 3: Implementation checklist (including recorded tests)

### Database

- [ ] Migration for `playwright_runs.project_id` (and indexes).
- [ ] **If Option B**: Migration for `project_recorded_tests` (project_id, recorded_test_id); keep `playwright_recorded_tests` without project_id.  
  **If Option A**: Migration adding `project_id` to `playwright_recorded_tests` (and backfill or default).
- [ ] Indexes for new FKs and for list-by-project queries.

### Backend

- [ ] Models: PlaywrightRun + project_id; Project ↔ PlaywrightRun associations.
- [ ] **Option B**: Model `ProjectRecordedTest`; Project ↔ PlaywrightRecordedTest many-to-many through it.  
  **Option A**: PlaywrightRecordedTest.project_id; Project hasMany PlaywrightRecordedTest.
- [ ] GET `/test-runs/unified` (or extended GET test-runs) with type filter and runType.
- [ ] POST `/playwright-runs/execute` with required `projectId`.
- [ ] GET `/playwright-tests/list?projectId=X`: return only recorded tests for project X (Option B: join project_recorded_tests; Option A: where project_id = X).
- [ ] **Option B**: GET `/projects/:id/recorded-tests` (recorded tests linked to project); POST/DELETE to add/remove link.  
  **Option A**: GET `/projects/:id/recorded-tests` (recorded tests where project_id = id); create already has project_id.
- [ ] POST `/playwright-recorded-tests`: **Option B** optional `addToProjectIds: [id, ...]` to create and link to projects. **Option A** require `projectId`.

### Frontend

- [ ] Test Runs: unified list, type badge, type filter, detail by runType + id.
- [ ] Project detail: "Run API tests", "Run UI Test", and **"Manage recorded tests"** (or "Recorded tests in project") that lists/selects recordings for this project.
- [ ] **Record a test** block: keep in overall UI Tests (or Recorded tests) section; wording unchanged.
- [ ] **Add recorded test**: keep in overall section; optional "Also add to project" dropdown (Option B) or require project context (Option A).
- [ ] **Manage recorded tests**: overall section = full global list (Option B) or list with project filter (Option A). From project = only that project’s tests and add/remove (Option B) or only that project’s tests CRUD (Option A).
- [ ] Run UI Tests: from project use current projectId; from overall section use project dropdown; test list always filtered by selected project.

---

## Summary

- **Unified API/UI**: One Test Runs list (API + UI), type badge and filter, project-scoped runs, "Run API tests" and "Run UI Test" from project.
- **Record a test**: Kept as the main entry in an overall section; "Define a test by recording browser actions with Playwright Codegen, then paste the generated code here"; **Add recorded test** and **Manage recorded tests** live there as the global pool (Option B) or as a project-filtered list (Option A).
- **Manage in project**: Each project has a way to **select** which recorded tests are used for that project (Option B: link to global pool) or to manage only that project’s own recordings (Option A).
- **Recommendation**: Option B (global pool + `project_recorded_tests`) so the same recording can be selected for multiple projects and the pattern matches API specs.
