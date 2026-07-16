const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const {
    Project,
    User,
    ApiSpec,
    Collection,
    TestRun,
    TestResult,
    PlaywrightRun,
    PlaywrightResult,
    FuzzRun,
    FuzzResult,
    ProjectTest,
    ProjectTestStat,
    ProjectTestNote,
    ProjectTestNoteAttachment
} = require('../models');
const { getProjectTestCatalogue } = require('./testCatalogue');
const { projectTestNoteEvidenceDir } = require('./fileUpload');
<<<<<<< HEAD
const { generateReport, getStableReportPath: getTestRunStableReportPath } = require('./reportGenerator');
=======
const { generateReport } = require('./reportGenerator');
const { generatePlaywrightReport } = require('./playwrightReportGenerator');
const { generateFuzzReport } = require('./fuzzReportGenerator');
>>>>>>> origin/main
const { normalizeTicketUrlsList, ticketUrlsToCsvCell } = require('../lib/ticketUrls');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR || path.join(PROJECT_ROOT, 'uploads'));
const REPORTS_ROOT = path.resolve(process.env.REPORTS_DIR || path.join(PROJECT_ROOT, 'reports'));
const NOTE_EVIDENCE_ROOT = path.resolve(projectTestNoteEvidenceDir);
const ALLOWED_FILE_ROOTS = [UPLOAD_ROOT, REPORTS_ROOT, NOTE_EVIDENCE_ROOT];
const PLAYWRIGHT_ARTIFACT_DIRS = {
    screenshot: path.join(REPORTS_ROOT, 'playwright-screenshots'),
    video: path.join(REPORTS_ROOT, 'playwright-videos'),
    trace: path.join(REPORTS_ROOT, 'playwright-traces')
};

function createZipArchive(options = { zlib: { level: 9 } }) {
    if (typeof archiver === 'function') {
        return archiver('zip', options);
    }

    if (archiver && typeof archiver.ZipArchive === 'function') {
        return new archiver.ZipArchive(options);
    }

    throw new TypeError('Unsupported archiver module export');
}

function toPlain(value) {
    if (!value) return value;
    if (Array.isArray(value)) return value.map(toPlain);
    if (typeof value.get === 'function') return value.get({ plain: true });
    return value;
}

function toIso(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function archiveTimestamp(date = new Date()) {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function sanitizePathPart(value, fallback = 'item') {
    const safe = String(value || fallback)
        .trim()
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^\.+/, '')
        .slice(0, 120);
    return safe || fallback;
}

function buildArchiveFilename(project, generatedAt = new Date()) {
    const projectPart = sanitizePathPart(project && project.name ? project.name : `project-${project?.id || 'unknown'}`);
    return `project-${project?.id || 'unknown'}-${projectPart}-audit-archive-${archiveTimestamp(generatedAt)}.zip`;
}

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeCsv(value) {
    if (value == null) return '';
    const str = String(value);
    if (/[",;\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
}

function displayUser(user) {
    if (!user) return 'Not recorded';
    const name = user.display_name || user.username || '';
    const email = user.email || '';
    if (name && email) return `${name} (${email})`;
    return name || email || 'Not recorded';
}

function firstRecordedUser(...users) {
    for (const user of users) {
        if (displayUser(user) !== 'Not recorded') return user;
    }
    return null;
}

function statusClass(status) {
    const normalized = String(status || 'not_run').toLowerCase().replace(/[\s_-]+/g, '-');
    if (normalized === 'passed' || normalized === 'success') return 'passed';
    if (normalized === 'failed' || normalized === 'error') return 'failed';
    if (normalized === 'running') return 'running';
    if (normalized === 'cancelled' || normalized === 'canceled') return 'cancelled';
    return 'not-run';
}

function isImageArchivePath(archivePath) {
    return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(String(archivePath || ''));
}

function archiveLink(archivePath, label, className = '') {
    if (!archivePath) return '<span class="muted">Not available</span>';
    const classAttr = className ? ` class="${escapeHtml(className)}"` : '';
    return `<a${classAttr} href="${escapeHtml(archivePath)}">${escapeHtml(label || archivePath)}</a>`;
}

function ticketLinks(ticketUrls) {
    const urls = (ticketUrls || []).map((url) => String(url || '').trim()).filter(Boolean);
    if (!urls.length) return '<span class="muted">No ticket links</span>';
    return urls.map((url) => `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`).join('<br>');
}

function detailLinks(paths) {
    return Object.entries(paths || {})
        .filter(([, archivePath]) => archivePath)
        .map(([label, archivePath]) => archiveLink(archivePath, label, 'small-link'))
        .join(' ');
}

function groupedReportLinksForTest(test) {
    const groups = new Map();
    (test.runEvidence || []).forEach((item) => {
        const reportPath = item.paths && item.paths['HTML report'];
        if (!reportPath) return;
        const groupLabel = `${item.kind} HTML reports`;
        if (!groups.has(groupLabel)) groups.set(groupLabel, new Map());
        groups.get(groupLabel).set(reportPath, {
            run_id: item.run_id,
            reportPath
        });
    });
    return groups;
}

function testFilesLinks(test) {
    const baseLinks = detailLinks(test.paths);
    const reportGroups = groupedReportLinksForTest(test);
    if (!reportGroups.size) return baseLinks;

    const reportLinks = [...reportGroups.entries()].map(([groupLabel, entries]) => {
        const links = [...entries.values()]
            .map((entry) => archiveLink(entry.reportPath, `HTML report (run ${entry.run_id})`, 'small-link'))
            .join(' ');
        return `<div class="muted" style="margin-top:8px;">${escapeHtml(groupLabel)}</div><div>${links}</div>`;
    }).join('');

    return `${baseLinks}${reportLinks}`;
}

function normalizeForMatch(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

function normalizeMethod(value) {
    return normalizeForMatch(value).toUpperCase();
}

function normalizeEndpoint(value) {
    return normalizeForMatch(value);
}

function isUiTestType(testType) {
    return normalizeForMatch(testType).startsWith('ui');
}

function isApiSoapTestType(testType) {
    const normalized = normalizeForMatch(testType);
    return normalized === 'api' || normalized === 'soap';
}

function isFuzzCapableTestType(testType) {
    const normalized = normalizeForMatch(testType);
    return normalized === 'api' || normalized === 'soap' || normalized === 'other';
}

function matchesApiSoapResultToTest(test, result) {
    if (!result) return false;
    const resultTestId = Number(result.test_id);
    if (!Number.isNaN(resultTestId) && resultTestId === Number(test.id)) return true;

    const resultName = normalizeForMatch(result.test_name);
    const testName = normalizeForMatch(test.name);
    const sameName = resultName && testName && resultName === testName;
    if (resultName && testName) return sameName;

    const sameMethod = normalizeMethod(result.method) && normalizeMethod(result.method) === normalizeMethod(test.method);
    const sameEndpoint = normalizeEndpoint(result.endpoint) && normalizeEndpoint(result.endpoint) === normalizeEndpoint(test.endpoint);
    return sameMethod && sameEndpoint;
}

function matchesUiResultToTest(test, result) {
    if (!result) return false;
    return normalizeForMatch(result.test_name) && normalizeForMatch(result.test_name) === normalizeForMatch(test.name);
}

function matchesFuzzResultToTest(test, result) {
    if (!result) return false;
    const resultName = normalizeForMatch(result.test_name);
    const testName = normalizeForMatch(test.name);
    const sameName = resultName && testName && resultName === testName;
    if (resultName && testName) return sameName;

    const sameMethod = normalizeMethod(result.method) && normalizeMethod(result.method) === normalizeMethod(test.method);
    const sameEndpoint = normalizeEndpoint(result.endpoint) && normalizeEndpoint(result.endpoint) === normalizeEndpoint(test.endpoint);
    return sameMethod && sameEndpoint;
}

function attachRunEvidenceToTests(tests, data, archiveMap) {
    const apiRunById = new Map((archiveMap.apiSoapRuns || []).map((run) => [Number(run.id), run]));
    const uiRunById = new Map((archiveMap.uiRuns || []).map((run) => [Number(run.id), run]));
    const fuzzRunById = new Map((archiveMap.fuzzRuns || []).map((run) => [Number(run.id), run]));

    return (tests || []).map((test) => {
        const runEvidence = [];

        if (isApiSoapTestType(test.test_type)) {
            (data.testRuns || []).forEach((run) => {
                const matchedResults = (run.testResults || []).filter((result) => matchesApiSoapResultToTest(test, result));
                if (!matchedResults.length) return;
                const entry = apiRunById.get(Number(run.id));
                if (!entry) return;
                runEvidence.push({
                    kind: 'API/SOAP',
                    run_id: run.id,
                    created_at: run.created_at,
                    status: run.status,
                    run_by: entry.runBy,
                    matched_results: matchedResults.length,
                    result_statuses: [...new Set(matchedResults.map((result) => result.status).filter(Boolean))],
                    paths: entry.paths || {}
                });
            });
        }

        if (isUiTestType(test.test_type)) {
            (data.playwrightRuns || []).forEach((run) => {
                const matchedResults = (run.results || []).filter((result) => matchesUiResultToTest(test, result));
                if (!matchedResults.length) return;
                const entry = uiRunById.get(Number(run.id));
                if (!entry) return;
                const resultArtifacts = [];
                matchedResults.forEach((result) => {
                    (entry.artifacts || []).forEach((artifact) => {
                        if (String(artifact.label || '').includes(` ${result.id}`)) {
                            resultArtifacts.push(artifact);
                        }
                    });
                });
                runEvidence.push({
                    kind: 'UI',
                    run_id: run.id,
                    created_at: run.created_at,
                    status: run.status,
                    run_by: entry.runBy,
                    matched_results: matchedResults.length,
                    result_statuses: [...new Set(matchedResults.map((result) => result.status).filter(Boolean))],
                    paths: entry.paths || {},
                    artifacts: resultArtifacts
                });
            });
        }

        if (isFuzzCapableTestType(test.test_type)) {
            (data.fuzzRuns || []).forEach((run) => {
                const matchedResults = (run.fuzzResults || []).filter((result) => matchesFuzzResultToTest(test, result));
                if (!matchedResults.length) return;
                const entry = fuzzRunById.get(Number(run.id));
                if (!entry) return;
                runEvidence.push({
                    kind: 'Fuzz',
                    run_id: run.id,
                    created_at: run.created_at,
                    status: run.status,
                    run_by: entry.runBy,
                    matched_results: matchedResults.length,
                    result_statuses: [...new Set(matchedResults.map((result) => result.status).filter(Boolean))],
                    paths: entry.paths || {}
                });
            });
        }

        return {
            ...test,
            runEvidence
        };
    });
}

function appendJson(archive, archivePath, data) {
    archive.append(`${JSON.stringify(data, null, 2)}\n`, { name: archivePath });
}

function appendText(archive, archivePath, content) {
    archive.append(content, { name: archivePath });
}

function isInsideRoot(filePath, root) {
    const relative = path.relative(root, filePath);
    return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveAllowedFilePath(filePath) {
    if (!filePath) return null;
    const candidate = path.isAbsolute(filePath) ?
        path.resolve(filePath) :
        path.resolve(PROJECT_ROOT, filePath);
    return ALLOWED_FILE_ROOTS.some((root) => isInsideRoot(candidate, root)) ? candidate : null;
}

function addFileOrDirectory(archive, manifest, sourcePath, archivePath) {
    const resolvedPath = resolveAllowedFilePath(sourcePath);
    if (!resolvedPath) {
        manifest.missing_artifacts.push({ source_path: sourcePath, archive_path: archivePath, reason: 'Path is outside allowed archive roots' });
        return false;
    }
    if (!fs.existsSync(resolvedPath)) {
        manifest.missing_artifacts.push({ source_path: sourcePath, archive_path: archivePath, reason: 'File does not exist' });
        return false;
    }
    const stats = fs.statSync(resolvedPath);
    if (stats.isDirectory()) {
        archive.directory(resolvedPath, archivePath);
    } else {
        archive.file(resolvedPath, { name: archivePath });
    }
    manifest.included_artifacts.push({ source_path: sourcePath, archive_path: archivePath, size_bytes: stats.isDirectory() ? null : stats.size });
    return true;
}

function resolvePlaywrightArtifactSource(filePath, artifactType) {
    if (!filePath) return null;
    if (path.isAbsolute(filePath)) return filePath;

    const typedRoot = PLAYWRIGHT_ARTIFACT_DIRS[artifactType];
    if (typedRoot) {
        const typedCandidate = path.resolve(typedRoot, filePath);
        if (fs.existsSync(typedCandidate)) return typedCandidate;
    }

    const reportsCandidate = path.resolve(REPORTS_ROOT, filePath);
    if (fs.existsSync(reportsCandidate)) return reportsCandidate;

    return filePath;
}

function addPlaywrightArtifact(archive, manifest, sourcePath, archivePath, artifactType) {
    return addFileOrDirectory(archive, manifest, resolvePlaywrightArtifactSource(sourcePath, artifactType), archivePath);
}

async function addGeneratedReport(archive, manifest, generator, runId, archivePath, options = {}) {
    try {
        const report = await generator(runId, options);
        const included = addFileOrDirectory(archive, manifest, report.filePath, archivePath);
        return included ? archivePath : null;
    } catch (error) {
        manifest.missing_artifacts.push({
            source_path: `generated-report:${runId}`,
            archive_path: archivePath,
            reason: error.message || String(error)
        });
        return null;
    }
}

function catalogueToCsv(rows) {
    const header = [
        'ID',
        'Name',
        'Type',
        'Last status',
        'Last run',
        'Total runs',
        'Active',
        'Spec status',
        'Source spec',
        'Source spec file',
        'Endpoint',
        'Method',
        'Description',
        'Ticket URLs',
        'Folder',
        'Default folder path',
        'Folder override'
    ];
    const lines = [header.map(escapeCsv).join(';')];
    rows.forEach((row) => {
        const stats = row.stats || {};
        lines.push([
            row.id,
            row.name || '',
            row.test_type || '',
            stats.last_status || 'not_run',
            stats.last_run_at ? toIso(stats.last_run_at) : '',
            stats.total_runs != null ? stats.total_runs : 0,
            row.is_active ? 'Yes' : 'No',
            row.source_api_spec_status || 'current',
            row.source_api_spec_name || '',
            row.source_api_spec_original_filename || '',
            row.endpoint || '',
            row.method || '',
            row.description || '',
            ticketUrlsToCsvCell(normalizeTicketUrlsList(row)),
            row.effective_folder_path || row.folder_path_override || row.default_folder_path || '',
            row.default_folder_path || '',
            row.folder_path_override || ''
        ].map(escapeCsv).join(';'));
    });
    return `${lines.join('\n')}\n`;
}

<<<<<<< HEAD
function typeLabel(testType) {
        if (testType === 'soap') return 'SOAP';
        if (testType === 'ui_builtin') return 'UI (built-in)';
        if (testType === 'ui_recorded') return 'UI (recorded)';
        if (testType === 'manual') return 'Manual Test';
        if (testType === 'other') return 'Other';
        return 'API';
}

function reportStatusClass(status) {
        const normalized = String(status || 'not_run').toLowerCase();
        if (normalized === 'passed') return 'passed';
        if (normalized === 'failed') return 'failed';
        if (normalized === 'partial_failed') return 'partial_failed';
        if (normalized === 'running') return 'running';
        if (normalized === 'cancelled' || normalized === 'canceled') return 'cancelled';
        return 'pending';
}

function reportStatusLabel(status) {
        return String(status || 'not_run').toUpperCase().replace(/_/g, ' ');
}

function buildCoverageSummary(tests) {
        const activeTests = (tests || []).filter((test) => test.is_active !== false);
        const counts = activeTests.reduce((acc, test) => {
                const status = String((test.stats && test.stats.last_status) || 'not_run').toLowerCase();
                if (status === 'passed') acc.passed += 1;
                else if (status === 'failed') acc.failed += 1;
                else if (status === 'partial_failed') acc.partial += 1;
                else acc.notRun += 1;
                if (status !== 'not_run') acc.testsEverRun += 1;
                return acc;
        }, { totalTests: activeTests.length, testsEverRun: 0, passed: 0, failed: 0, partial: 0, notRun: 0 });
        counts.successPct = counts.totalTests ? Math.round((counts.passed / counts.totalTests) * 100) : 0;
        counts.coveragePct = counts.totalTests ? Math.round(((counts.passed + counts.failed + counts.partial) / counts.totalTests) * 100) : 0;
        return counts;
}

function evidenceLinks(paths) {
        const links = detailLinks(paths);
        return links || '<span class="muted">No detailed evidence for the latest registered run.</span>';
}

function truncateEvidenceText(value, maxLength = 6000) {
    const text = String(value || '').trim();
    if (!text) return '';
    return text.length > maxLength ? `${text.slice(0, maxLength)}\n... [truncated in report; open the evidence file for full content]` : text;
}

function buildLatestEvidenceProof(latestEvidence) {
    if (!latestEvidence) {
        return '<p class="muted">No latest evidence is linked for this coverage row yet.</p>';
    }

    const request = truncateEvidenceText(latestEvidence.request_body);
    const response = truncateEvidenceText(latestEvidence.response_body);
    const media = latestEvidence.media || [];
    const mediaHtml = media.length ? `<div class="ui-media"><h4>UI evidence recordings</h4><div class="media-grid">${media.map((item) => {
        if (item.kind === 'video') {
            return `<figure><video controls preload="metadata" src="${escapeHtml(item.archivePath)}"></video><figcaption>${escapeHtml(item.label)}</figcaption></figure>`;
        }
        if (item.kind === 'image') {
            return `<figure><a href="${escapeHtml(item.archivePath)}"><img src="${escapeHtml(item.archivePath)}" alt="${escapeHtml(item.label)}"></a><figcaption>${escapeHtml(item.label)}</figcaption></figure>`;
        }
        return `<div class="media-link">${archiveLink(item.archivePath, item.label, 'small-link')}</div>`;
    }).join('')}</div></div>` : '';
    const metaRows = [
        ['Run ID', latestEvidence.runId],
        ['Result ID', latestEvidence.resultId],
        ['Status', latestEvidence.status],
        ['Method', latestEvidence.method],
        ['Endpoint', latestEvidence.endpoint],
        ['Response code', latestEvidence.response_code],
        ['Created', toIso(latestEvidence.created_at)]
    ].filter(([, value]) => value != null && value !== '');

    return `<div class="latest-proof">
        <div class="proof-meta">${metaRows.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}</div>
        <div class="proof-grid">
            <div><h4>Actual request</h4>${request ? `<pre>${escapeHtml(request)}</pre>` : '<p class="muted">No request body recorded for this result.</p>'}</div>
            <div><h4>Actual response</h4>${response ? `<pre>${escapeHtml(response)}</pre>` : '<p class="muted">No response body recorded for this result.</p>'}</div>
        </div>
        ${mediaHtml}
    </div>`;
}

function buildIndexHtml({ project, generatedAt, manifest, archiveMap }) {
        const tests = archiveMap.tests || [];
        const coverage = buildCoverageSummary(tests);
        const coverageSection = `
            <div class="cards">
                <div class="card"><div class="card-label">Active tests in coverage</div><div class="card-value">${coverage.totalTests}</div><div class="card-subtext">${coverage.testsEverRun} tests have been run at least once</div></div>
                <div class="card"><div class="card-label">Total tests passed</div><div class="card-value success">${coverage.passed}</div><div class="card-subtext">${coverage.successPct}% of active tests</div></div>
                <div class="card"><div class="card-label">Total tests failed</div><div class="card-value error">${coverage.failed + coverage.partial}</div><div class="card-subtext">${coverage.coveragePct}% coverage (passed / failed / partial)</div></div>
                <div class="card"><div class="card-label">Not yet run</div><div class="card-value">${coverage.notRun}</div><div class="card-subtext">Active tests with no successful or failed runs yet</div></div>
            </div>`;
=======
function buildIndexHtml({ project, generatedAt, manifest, archiveMap }) {
    const counts = manifest.counts;
    const tests = archiveMap.tests || [];
    const apiSoapRuns = archiveMap.apiSoapRuns || [];
    const uiRuns = archiveMap.uiRuns || [];
    const fuzzRuns = archiveMap.fuzzRuns || [];
    const missingRows = manifest.missing_artifacts.length ?
        manifest.missing_artifacts.map((item) => `<tr><td>${escapeHtml(item.archive_path)}</td><td>${escapeHtml(item.reason)}</td><td>${escapeHtml(item.source_path)}</td></tr>`).join('') :
        '<tr><td colspan="3">No missing artifacts recorded.</td></tr>';

    const summaryCards = [
        ['Tests', counts.project_tests],
        ['Notes', counts.project_test_notes],
        ['Evidence images', counts.project_test_note_attachments],
        ['API/SOAP runs', counts.api_soap_runs],
        ['UI runs', counts.ui_runs],
        ['Fuzz runs', counts.fuzz_runs],
        ['Included files', manifest.included_artifacts.length],
        ['Missing files', manifest.missing_artifacts.length]
    ].map(([label, value]) => `<div class="summary-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
>>>>>>> origin/main

    const testRows = tests.length ? tests.map((test) => {
                const stats = test.stats || {};
<<<<<<< HEAD
                const lastStatus = stats.last_status || 'not_run';
                const folder = test.effective_folder_path || test.folder_path_override || test.default_folder_path || '';
                const ticketText = (test.ticketUrls || []).join(' ');
                const historyHtml = test.history && test.history.length ? `
                    <table class="nested-table">
                        <thead><tr><th>Run</th><th>Type</th><th>Status</th><th>Created</th><th>Duration</th><th>Run by</th></tr></thead>
                        <tbody>${test.history.map((entry) => `<tr><td>${escapeHtml(entry.runName || `Run ${entry.runId || ''}`)}<div class="muted">Result ${escapeHtml(entry.resultId || '')}</div></td><td>${escapeHtml(entry.kind)}</td><td><span class="status-badge ${reportStatusClass(entry.status)}">${escapeHtml(reportStatusLabel(entry.status))}</span></td><td>${escapeHtml(toIso(entry.created_at || entry.runCreatedAt) || '')}</td><td>${entry.duration_ms != null ? escapeHtml(`${entry.duration_ms} ms`) : '—'}</td><td>${escapeHtml(entry.runBy || 'Not recorded')}</td></tr>`).join('')}</tbody>
                    </table>` : '<p class="muted">No linked run history yet. Run the backfill script to link historical rows.</p>';
                const notesHtml = test.notes && test.notes.length ? test.notes.map((note) => {
                        const attachments = note.attachments && note.attachments.length ? note.attachments.map((attachment) => {
                                const image = attachment.archivePath && attachment.isImage ? `<a href="${escapeHtml(attachment.archivePath)}"><img src="${escapeHtml(attachment.archivePath)}" alt="${escapeHtml(attachment.original_name || 'Evidence image')}"></a>` : '';
                                return `<div class="evidence-item">${image}${archiveLink(attachment.archivePath, attachment.original_name || `Attachment ${attachment.id}`)}</div>`;
                        }).join('') : '<p class="muted">No evidence images.</p>';
                        return `<div class="note-card"><div class="note-meta">${escapeHtml(note.author || 'Not recorded')} - ${escapeHtml(toIso(note.created_at) || '')}</div><p>${escapeHtml(note.note || '')}</p><div class="evidence-grid">${attachments}</div></div>`;
                }).join('') : '<p class="muted">No notes recorded.</p>';
                return `<tr data-name="${escapeHtml(test.name || '')}" data-type="${escapeHtml(test.test_type || '')}" data-status="${escapeHtml(lastStatus)}" data-ticket="${escapeHtml(ticketText)}" data-folder="${escapeHtml(folder)}">
                    <td>${escapeHtml(test.name || '')}</td>
                    <td>${escapeHtml(folder || '—')}</td>
                    <td>${escapeHtml(typeLabel(test.test_type))}</td>
                    <td><span class="status-badge ${reportStatusClass(lastStatus)}">${escapeHtml(reportStatusLabel(lastStatus))}</span></td>
                    <td>${escapeHtml(toIso(stats.last_run_at) || '—')}</td>
                    <td>${escapeHtml(String(stats.total_runs != null ? stats.total_runs : 0))}</td>
                    <td>${escapeHtml(test.lastRunBy || '—')}</td>
                    <td>${ticketLinks(test.ticketUrls)}</td>
                </tr>
                <tr class="details-row" data-detail-for="${escapeHtml(test.name || '')}" data-name="${escapeHtml(test.name || '')}" data-type="${escapeHtml(test.test_type || '')}" data-status="${escapeHtml(lastStatus)}" data-ticket="${escapeHtml(ticketText)}" data-folder="${escapeHtml(folder)}">
                    <td colspan="8">
                        <details>
                            <summary>Evidence package</summary>
                            <div class="evidence-layout">
                                <div><h3>Latest registered evidence</h3><p class="muted">Matches the last status and last run shown in coverage.</p>${buildLatestEvidenceProof(test.latestEvidence)}<div class="file-grid">${evidenceLinks(test.latestEvidence && test.latestEvidence.paths)}</div></div>
                                <div><h3>Historical run context</h3>${historyHtml}</div>
                                <div><h3>Notes and attachments</h3>${notesHtml}</div>
                                <div><h3>Archive files</h3><div class="file-grid">${detailLinks(test.paths)}</div></div>
                            </div>
                        </details>
                    </td>
=======
                const filesHtml = testFilesLinks(test);
                const runEvidenceHtml = (test.runEvidence || []).length ?
                    `<div>${test.runEvidence.map((item) => {
                                const statuses = item.result_statuses && item.result_statuses.length ? item.result_statuses.join(', ') : 'not recorded';
                                const artifacts = (item.artifacts || []).length ? (item.artifacts || []).map((artifact) => archiveLink(artifact.archivePath, artifact.label, 'small-link')).join(' ') : '';
                                const reportLink = item.paths && item.paths['HTML report'] ? archiveLink(item.paths['HTML report'], 'HTML report', 'small-link') : '<span class="muted">HTML report not available</span>';
                                const otherLinks = detailLinks(Object.fromEntries(Object.entries(item.paths || {}).filter(([label]) => label !== 'HTML report')));
                                return `<div class="note-card"><div class="note-meta">${escapeHtml(item.kind)} run #${escapeHtml(item.run_id)} - ${escapeHtml(toIso(item.created_at) || '')} - ${escapeHtml(item.run_by || 'Not recorded')}</div><p><span class="status ${statusClass(item.status)}">${escapeHtml(item.status || 'not_run')}</span> Matched results: ${escapeHtml(item.matched_results)} (${escapeHtml(statuses)})</p><div><strong>Report:</strong> ${reportLink}</div><div>${otherLinks} ${artifacts}</div></div>`;
                        }).join('')}</div>` :
                    '<p class="muted">No linked run evidence for this test.</p>';
                const notesHtml = test.notes.length ? test.notes.map((note) => {
                            const attachments = note.attachments.length ? note.attachments.map((attachment) => {
                                        const image = attachment.archivePath && attachment.isImage ?
                                            `<a href="${escapeHtml(attachment.archivePath)}"><img src="${escapeHtml(attachment.archivePath)}" alt="${escapeHtml(attachment.original_name || 'Evidence image')}"></a>` :
                                            '';
                                        return `<div class="evidence-item">${image}${archiveLink(attachment.archivePath, attachment.original_name || `Attachment ${attachment.id}`)}</div>`;
                        }).join('') : '<p class="muted">No evidence images.</p>';
                        return `<div class="note-card"><div class="note-meta">Note ${escapeHtml(note.id)} - ${escapeHtml(toIso(note.created_at) || '')} - ${escapeHtml(note.author || 'Not recorded')}</div><p>${escapeHtml(note.note || '')}</p><div class="evidence-grid">${attachments}</div></div>`;
                }).join('') : '<p class="muted">No notes recorded.</p>';
                return `<tr>
                        <td><strong>${escapeHtml(test.name)}</strong><div class="muted">Test ID ${escapeHtml(test.id)} - ${escapeHtml(test.test_type || '')}${test.method ? ` - ${escapeHtml(test.method)}` : ''}</div>${test.endpoint ? `<div class="muted">${escapeHtml(test.endpoint)}</div>` : ''}</td>
                        <td><span class="status ${statusClass(stats.last_status)}">${escapeHtml(stats.last_status || 'not_run')}</span></td>
                        <td>${escapeHtml(toIso(stats.last_run_at) || 'Not run')}</td>
                        <td>${escapeHtml(test.lastRunBy || 'Not recorded')}</td>
                        <td>${ticketLinks(test.ticketUrls)}</td>
                        <td>${filesHtml}</td>
                </tr>
                <tr class="notes-row"><td colspan="6"><strong>Run evidence</strong>${runEvidenceHtml}<strong>Notes</strong>${notesHtml}</td></tr>`;
        }).join('') : '<tr><td colspan="6">No project tests were archived.</td></tr>';

        const apiRows = apiSoapRuns.length ? apiSoapRuns.map((run) => `<tr>
                <td><strong>${escapeHtml(run.name)}</strong><div class="muted">${escapeHtml(run.run_type || 'api')}</div></td>
                <td><span class="status ${statusClass(run.status)}">${escapeHtml(run.status || '')}</span></td>
                <td>${escapeHtml(toIso(run.created_at) || '')}</td>
                <td>${escapeHtml(run.runBy || 'Not recorded')}</td>
                <td>${escapeHtml(`${run.passed_tests || 0}/${run.total_tests || 0} passed`)}</td>
                <td>${detailLinks(run.paths)}</td>
        </tr>`).join('') : '<tr><td colspan="6">No API/SOAP runs were archived.</td></tr>';

        const uiRows = uiRuns.length ? uiRuns.map((run) => {
                const artifacts = run.artifacts.length ? run.artifacts.map((artifact) => archiveLink(artifact.archivePath, artifact.label, 'small-link')).join(' ') : '<span class="muted">No artifacts</span>';
                return `<tr>
                        <td><strong>${escapeHtml(run.name)}</strong><div class="muted">Browser: ${escapeHtml(run.browser_name || 'Not recorded')}</div></td>
                        <td><span class="status ${statusClass(run.status)}">${escapeHtml(run.status || '')}</span></td>
                        <td>${escapeHtml(toIso(run.created_at) || '')}</td>
                        <td>${escapeHtml(run.runBy || 'Not recorded')}</td>
                        <td>${escapeHtml(`${run.passed_tests || 0}/${run.total_tests || 0} passed`)}</td>
                        <td>${detailLinks(run.paths)} ${artifacts}</td>
>>>>>>> origin/main
                </tr>`;
        }).join('') : '<tr><td colspan="8">No project tests were archived.</td></tr>';

<<<<<<< HEAD
        const missingRows = manifest.missing_artifacts.length ? manifest.missing_artifacts.map((item) => `<tr><td>${escapeHtml(item.archive_path)}</td><td>${escapeHtml(item.reason)}</td><td>${escapeHtml(item.source_path)}</td></tr>`).join('') : '<tr><td colspan="3">No missing artifacts recorded.</td></tr>';
=======
        const fuzzRows = fuzzRuns.length ? fuzzRuns.map((run) => `<tr>
                <td><strong>${escapeHtml(run.name)}</strong><div class="muted">${escapeHtml(run.apiSpecName || '')}</div></td>
                <td><span class="status ${statusClass(run.status)}">${escapeHtml(run.status || '')}</span></td>
                <td>${escapeHtml(toIso(run.created_at) || '')}</td>
                <td>${escapeHtml(run.runBy || 'Not recorded')}</td>
                <td>${escapeHtml(`${run.passed_tests || 0}/${run.total_tests || 0} passed`)}</td>
                <td>${detailLinks(run.paths)}</td>
        </tr>`).join('') : '<tr><td colspan="6">No fuzz runs were archived.</td></tr>';
>>>>>>> origin/main

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Tests &amp; Coverage report - ${escapeHtml(project.name)}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        :root { --color-primary: #14b8a6; --color-primary-dark: #0d9488; --color-gray-50: #f9fafb; --color-gray-100: #f3f4f6; --color-gray-200: #e5e7eb; --color-gray-300: #d1d5db; --color-gray-500: #6b7280; --color-white: #ffffff; --color-success: #10b981; --color-error: #ef4444; --color-warning: #f59e0b; --color-text-primary: #111827; --color-text-secondary: #6b7280; --shadow-sm: 0 1px 2px rgba(0,0,0,.05); --shadow-md: 0 1px 3px rgba(0,0,0,.1), 0 1px 2px rgba(0,0,0,.06); --shadow-lg: 0 10px 15px -3px rgba(0,0,0,.1), 0 4px 6px -2px rgba(0,0,0,.05); }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; background: var(--color-gray-100); color: var(--color-text-primary); }
        .page { max-width: 1200px; margin: 0 auto; background: var(--color-white); min-height: 100vh; box-shadow: var(--shadow-lg); }
        .page-header { background: #00474F; color: #ffffff; padding: 20px 24px; }
        .page-header h1 { font-size: 22px; margin: 0 0 4px 0; font-weight: 600; }
        .page-header .meta { font-size: 13px; color: rgba(249,250,251,.8); }
        .page-body { padding: 24px; background: var(--color-gray-100); }
        h2 { font-size: 18px; margin-top: 0; margin-bottom: 8px; }
        h3 { font-size: 14px; margin: 12px 0 6px; }
        .section { background: var(--color-white); border-radius: 16px; padding: 20px; box-shadow: 0 4px 6px -1px rgba(0,0,0,.1), 0 2px 4px -1px rgba(0,0,0,.06); margin-bottom: 20px; border: 1px solid var(--color-gray-200); }
        .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-top: 12px; }
        .card { background: var(--color-white); border-radius: 12px; padding: 16px; box-shadow: var(--shadow-md); position: relative; overflow: hidden; }
        .card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 4px; background: linear-gradient(90deg, var(--color-primary), #5eead4); }
        .card-label { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: var(--color-gray-500); margin-bottom: 6px; }
        .card-value { font-size: 28px; font-weight: 700; color: var(--color-primary); }
        .card-value.success { color: var(--color-success); }
        .card-value.error { color: var(--color-error); }
        .card-subtext { font-size: 12px; color: var(--color-gray-500); margin-top: 4px; }
        .filters { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; margin-bottom: 12px; }
        .filters input, .filters select { padding: 8px 12px; border-radius: 8px; border: 2px solid var(--color-primary); font-size: 14px; background: var(--color-white); color: var(--color-text-primary); }
        .filters button { padding: 8px 24px; border-radius: 8px; border: none; font-size: 14px; font-weight: 500; cursor: pointer; }
        .btn-primary { background: var(--color-primary); color: #fff; }
        .btn-secondary { background: var(--color-gray-200); color: var(--color-text-primary); }
        table { width: 100%; border-collapse: collapse; margin-top: 8px; background: var(--color-white); border-radius: 12px; overflow: hidden; }
        thead { background: var(--color-gray-50); }
        th, td { padding: 8px 10px; font-size: 13px; text-align: left; border-bottom: 1px solid var(--color-gray-200); vertical-align: top; }
        th { font-weight: 600; color: #4b5563; }
        tbody tr:nth-child(4n+3), tbody tr:nth-child(4n+4) { background: var(--color-gray-50); }
        a { color: #2563eb; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .count, .muted { font-size: 13px; color: var(--color-gray-500); }
        .status-badge { display: inline-flex; align-items: center; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; box-shadow: var(--shadow-sm); white-space: nowrap; color: #fff; }
        .status-badge.passed { background: var(--color-success); }
        .status-badge.failed { background: var(--color-error); }
        .status-badge.partial_failed, .status-badge.running { background: var(--color-warning); }
        .status-badge.cancelled { background: #94a3b8; }
        .status-badge.pending { background: var(--color-gray-500); }
        .details-row td { padding: 0 10px 12px; }
        details { border: 1px solid var(--color-gray-200); border-radius: 8px; background: #fff; padding: 10px 12px; }
        summary { cursor: pointer; font-weight: 600; color: var(--color-text-primary); }
        .evidence-layout { display: grid; gap: 12px; margin-top: 10px; }
        .file-grid { display: flex; flex-wrap: wrap; gap: 8px; }
        .small-link { display: inline-block; padding: 4px 8px; border: 1px solid var(--color-gray-200); border-radius: 999px; background: #fff; font-size: 12px; }
        .latest-proof { border: 1px solid var(--color-gray-200); border-radius: 8px; padding: 12px; background: var(--color-gray-50); margin-bottom: 10px; }
        .proof-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; margin-bottom: 10px; }
        .proof-meta div { background: #fff; border: 1px solid var(--color-gray-200); border-radius: 8px; padding: 8px; }
        .proof-meta span { display: block; color: var(--color-gray-500); font-size: 11px; text-transform: uppercase; letter-spacing: .06em; }
        .proof-meta strong { display: block; margin-top: 2px; font-size: 12px; word-break: break-word; }
        .proof-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 10px; }
        .proof-grid h4 { font-size: 13px; margin: 0 0 6px; }
        .proof-grid pre { margin: 0; max-height: 360px; overflow: auto; white-space: pre-wrap; word-break: break-word; background: #111827; color: #f9fafb; border-radius: 8px; padding: 10px; font-size: 12px; line-height: 1.45; }
        .ui-media { margin-top: 12px; }
        .media-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
        .media-grid figure { margin: 0; border: 1px solid var(--color-gray-200); border-radius: 8px; background: #fff; padding: 8px; }
        .media-grid video, .media-grid img { display: block; width: 100%; max-height: 280px; object-fit: contain; border-radius: 6px; background: #111827; }
        .media-grid figcaption { margin-top: 6px; font-size: 12px; color: var(--color-gray-500); }
        .media-link { align-self: start; }
        .nested-table th, .nested-table td { font-size: 12px; }
        .note-card { border: 1px solid var(--color-gray-200); border-radius: 8px; padding: 10px; margin: 8px 0; background: #fff; }
        .note-meta { color: var(--color-gray-500); font-size: 12px; font-weight: 700; text-transform: uppercase; }
        .evidence-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-top: 10px; }
        .evidence-item { border: 1px solid var(--color-gray-200); border-radius: 8px; padding: 8px; background: #fff; }
        .evidence-item img { display: block; max-width: 100%; max-height: 180px; object-fit: contain; margin-bottom: 8px; border-radius: 6px; border: 1px solid var(--color-gray-200); }
        @media (max-width: 760px) { .page-body { padding: 12px; } th, td { font-size: 12px; } .cards { grid-template-columns: 1fr; } }
    </style>
</head>
<body>
    <div class="page">
        <div class="page-header"><h1>Tests &amp; Coverage report</h1><div class="meta">Project: <strong>${escapeHtml(project.name)}</strong> (ID: ${escapeHtml(project.id)})<br>Generated at: ${escapeHtml(toIso(generatedAt))}</div></div>
        <div class="page-body">
            <div class="section"><h2>Coverage summary</h2>${coverageSection}</div>
            <div class="section"><h2>Tests (filtered snapshot)</h2><div class="filters"><input type="text" id="filter-search" placeholder="Search by name or ticket..."><select id="filter-type"><option value="">All Types</option><option value="api">API</option><option value="soap">SOAP</option><option value="ui_builtin">UI (built-in)</option><option value="ui_recorded">UI (recorded)</option><option value="manual">Manual Test</option><option value="other">Other</option></select><select id="filter-status"><option value="">All statuses</option><option value="passed">Passed</option><option value="failed">Failed</option><option value="partial_failed">Partial Failed</option><option value="running">Running</option><option value="cancelled">Cancelled</option><option value="not_run">Not run</option></select><button class="btn-primary" id="filter-apply">Apply</button><button class="btn-secondary" id="filter-clear">Clear</button></div><div class="count" id="filtered-count"></div><table id="tests-table"><thead><tr><th>Name</th><th>Folder</th><th>Type</th><th>Last status</th><th>Last run</th><th>Total runs</th><th>Last run by</th><th>Tickets</th></tr></thead><tbody>${testRows}</tbody></table></div>
            <div class="section"><h2>Archive files</h2><div class="file-grid">${archiveLink(archiveMap.core.projectJson, 'Project JSON', 'small-link')}${archiveLink(archiveMap.core.manifestJson, 'Manifest JSON', 'small-link')}${archiveLink(archiveMap.core.catalogueCsv, 'Tests CSV', 'small-link')}${archiveLink(archiveMap.core.catalogueJson, 'Tests JSON', 'small-link')}${archiveLink(archiveMap.core.testsWithNotesJson, 'Tests with notes JSON', 'small-link')}</div></div>
            <div class="section"><h2>Missing artifacts</h2><table><thead><tr><th>Archive path</th><th>Reason</th><th>Source path</th></tr></thead><tbody>${missingRows}</tbody></table></div>
        </div>
    </div>
    <script>
        (function() {
            const rows = Array.from(document.querySelectorAll('#tests-table tbody tr'));
            const count = document.getElementById('filtered-count');
            function applyFilters() {
                const search = (document.getElementById('filter-search').value || '').toLowerCase();
                const type = document.getElementById('filter-type').value;
                const status = document.getElementById('filter-status').value;
                let visibleTests = 0;
                for (let i = 0; i < rows.length; i += 2) {
                    const main = rows[i];
                    const detail = rows[i + 1];
                    const haystack = [main.dataset.name, main.dataset.ticket, main.dataset.folder].join(' ').toLowerCase();
                    const visible = (!search || haystack.includes(search)) && (!type || main.dataset.type === type) && (!status || main.dataset.status === status);
                    main.style.display = visible ? '' : 'none';
                    if (detail) detail.style.display = visible ? '' : 'none';
                    if (visible) visibleTests += 1;
                }
                count.textContent = visibleTests + ' tests shown in table';
            }
            document.getElementById('filter-apply').addEventListener('click', applyFilters);
            document.getElementById('filter-clear').addEventListener('click', function() { document.getElementById('filter-search').value = ''; document.getElementById('filter-type').value = ''; document.getElementById('filter-status').value = ''; applyFilters(); });
            applyFilters();
        })();
    </script>
</body>
</html>\n`;
}

async function loadArchiveData(projectId) {
    const project = await Project.findByPk(projectId, {
        include: [
            { model: User, as: 'owner', attributes: ['id', 'username', 'display_name', 'email'], required: false },
            { model: User, as: 'members', attributes: ['id', 'username', 'display_name', 'email'], through: { attributes: ['created_at'] }, required: false },
            { model: ApiSpec, as: 'apiSpecs', include: [{ model: Collection, as: 'collections', required: false }], required: false },
            { model: Collection, as: 'standaloneCollections', required: false }
        ]
    });
    if (!project) {
        const error = new Error('Project not found');
        error.statusCode = 404;
        throw error;
    }

    const [catalogueRows, projectTests, testRuns, playwrightRuns, fuzzRuns] = await Promise.all([
        getProjectTestCatalogue(projectId),
        ProjectTest.findAll({
            where: { project_id: projectId },
            include: [
                {
                    model: ProjectTestStat,
                    as: 'stats',
                    required: false,
                    include: [{ model: User, as: 'lastRunByUser', attributes: ['id', 'username', 'display_name', 'email'], required: false }]
                },
                {
                    model: ProjectTestNote,
                    as: 'notes',
                    required: false,
                    include: [
                        { model: User, as: 'author', attributes: ['id', 'username', 'display_name', 'email'], required: false },
                        { model: ProjectTestNoteAttachment, as: 'attachments', required: false }
                    ]
<<<<<<< HEAD
                },
                {
                    model: TestResult,
                    as: 'apiSoapResults',
                    required: false,
                    include: [{ model: TestRun, as: 'testRun', required: false, include: [{ model: User, as: 'runByUser', attributes: ['id', 'username', 'display_name', 'email'], required: false }] }]
                },
                {
                    model: PlaywrightResult,
                    as: 'uiResults',
                    required: false,
                    include: [{ model: PlaywrightRun, as: 'playwrightRun', required: false, include: [{ model: User, as: 'runByUser', attributes: ['id', 'username', 'display_name', 'email'], required: false }] }]
                },
                {
                    model: FuzzResult,
                    as: 'fuzzResults',
                    required: false,
                    include: [{ model: FuzzRun, as: 'fuzzRun', required: false }]
=======
>>>>>>> origin/main
                }
            ],
            order: [
                ['source_order', 'ASC'],
                ['id', 'ASC'],
                [{ model: ProjectTestNote, as: 'notes' }, 'created_at', 'ASC'],
                [{ model: ProjectTestNote, as: 'notes' }, { model: ProjectTestNoteAttachment, as: 'attachments' }, 'created_at', 'ASC'],
                [{ model: TestResult, as: 'apiSoapResults' }, 'created_at', 'DESC'],
                [{ model: PlaywrightResult, as: 'uiResults' }, 'created_at', 'DESC'],
                [{ model: FuzzResult, as: 'fuzzResults' }, 'created_at', 'DESC']
            ]
        }),
        TestRun.findAll({
            where: { project_id: projectId },
            include: [
                { model: User, as: 'runByUser', attributes: ['id', 'username', 'display_name', 'email'], required: false },
                { model: TestResult, as: 'testResults', required: false }
            ],
            order: [
                ['created_at', 'DESC'],
                [{ model: TestResult, as: 'testResults' }, 'execution_order', 'ASC'],
                [{ model: TestResult, as: 'testResults' }, 'id', 'ASC']
            ]
        }),
        PlaywrightRun.findAll({
            where: { project_id: projectId },
            include: [
<<<<<<< HEAD
                { model: User, as: 'runByUser', attributes: ['id', 'username', 'display_name', 'email'], required: false },
=======
>>>>>>> origin/main
                { model: PlaywrightResult, as: 'results', required: false }
            ],
            order: [
                ['created_at', 'DESC'],
                [{ model: PlaywrightResult, as: 'results' }, 'execution_order', 'ASC'],
                [{ model: PlaywrightResult, as: 'results' }, 'id', 'ASC']
            ]
        }),
        FuzzRun.findAll({
            where: { project_id: projectId },
            include: [
                { model: FuzzResult, as: 'fuzzResults', required: false },
                { model: ApiSpec, as: 'apiSpec', attributes: ['id', 'name', 'original_filename'], required: false }
            ],
            order: [
                ['created_at', 'DESC'],
                [{ model: FuzzResult, as: 'fuzzResults' }, 'execution_order', 'ASC'],
                [{ model: FuzzResult, as: 'fuzzResults' }, 'id', 'ASC']
            ]
        })
    ]);

    return {
        project: toPlain(project),
        catalogueRows: toPlain(catalogueRows),
        projectTests: toPlain(projectTests),
        testRuns: toPlain(testRuns),
        playwrightRuns: toPlain(playwrightRuns),
        fuzzRuns: toPlain(fuzzRuns)
    };
}

function sortEvidenceResults(results) {
    return [...(results || [])].sort((a, b) => {
        const aTime = new Date(a.created_at || a.runCreatedAt || 0).getTime();
        const bTime = new Date(b.created_at || b.runCreatedAt || 0).getTime();
        if (bTime !== aTime) return bTime - aTime;
        return (a.execution_order || 0) - (b.execution_order || 0);
    });
}

function summarizeHistoryEntry(kind, result) {
    const run = result.testRun || result.playwrightRun || result.fuzzRun || {};
    return {
        kind,
        runId: result.test_run_id || result.playwright_run_id || result.fuzz_run_id || run.id || null,
        resultId: result.id,
        name: result.test_name,
        status: result.status,
        created_at: result.created_at || run.created_at || null,
        duration_ms: result.duration_ms,
        execution_order: result.execution_order,
        runName: run.name || null,
        runStatus: run.status || null,
        runCreatedAt: run.created_at || null,
        runBy: displayUser(run.runByUser)
    };
}

function selectLatestRegisteredEvidence(test, history) {
    const stats = test.stats || {};
    const lastRunId = stats.last_run_id == null ? null : Number(stats.last_run_id);
    const source = String(stats.last_run_source || stats.last_run_type || '').toLowerCase();
    const candidates = history.filter((entry) => {
        if (lastRunId != null && Number(entry.runId) !== lastRunId) return false;
        if (!source) return true;
        if (source.includes('ui')) return entry.kind === 'ui';
        if (source.includes('fuzz')) return entry.kind === 'fuzz';
        if (source.includes('soap')) return entry.kind === 'api-soap';
        if (source.includes('api')) return entry.kind === 'api-soap';
        return true;
    });
    return candidates[0] || history[0] || null;
}

function normalizeEvidenceValue(value) {
    return String(value || '').trim().toLowerCase();
}

function resultMatchesTest(test, result) {
    if (!result) return false;
    const testName = normalizeEvidenceValue(test.name);
    const resultName = normalizeEvidenceValue(result.test_name);
    const testMethod = normalizeEvidenceValue(test.method);
    const resultMethod = normalizeEvidenceValue(result.method);
    const testEndpoint = normalizeEvidenceValue(test.endpoint).replace(/[?#].*$/, '');
    const resultEndpoint = normalizeEvidenceValue(result.endpoint).replace(/[?#].*$/, '');
    const methodMatches = !testMethod || !resultMethod || testMethod === resultMethod || testMethod === 'api';
    const nameMatches = testName && resultName && (testName === resultName || resultName.includes(testName) || testName.includes(resultName));
    const endpointMatches = testEndpoint && resultEndpoint && (testEndpoint === resultEndpoint || resultEndpoint.endsWith(testEndpoint) || testEndpoint.endsWith(resultEndpoint));
    return methodMatches && (nameMatches || endpointMatches);
}

function latestUiArtifactsForResult(artifacts, resultId) {
    const allArtifacts = Array.isArray(artifacts) ? artifacts : [];
    const resultArtifacts = allArtifacts.filter((artifact) => Number(artifact.resultId) === Number(resultId));
    if (resultArtifacts.length) return resultArtifacts;
    return allArtifacts.filter((artifact) => artifact.scope === 'run');
}

function findLatestCoverageResultFallback(test, archiveMap) {
    const stats = test.stats || {};
    const lastRunId = stats.last_run_id == null ? null : Number(stats.last_run_id);
    if (lastRunId == null) return null;
    const source = String(stats.last_run_source || stats.last_run_type || '').toLowerCase();

    if (!source || source.includes('api') || source.includes('soap')) {
        const runEntry = archiveMap.apiSoapRunById.get(lastRunId);
        const run = archiveMap.apiSoapRawRunById.get(lastRunId);
        const result = run && (run.testResults || []).find((item) => resultMatchesTest(test, item));
        if (result) {
            return {
                ...summarizeHistoryEntry('api-soap', result),
                raw: result,
                runByUser: run.runByUser,
                runPath: runEntry && runEntry.paths ? runEntry.paths['Run JSON'] : null,
                resultsPath: runEntry && runEntry.paths ? runEntry.paths['Results JSON'] : null,
                reportPath: runEntry && runEntry.paths ? runEntry.paths['HTML report'] : null,
                matchSource: 'coverage-last-run-fallback'
            };
        }
    }

    if (source.includes('ui')) {
        const runEntry = archiveMap.uiRunById.get(lastRunId);
        const run = archiveMap.uiRawRunById.get(lastRunId);
        const result = run && (run.results || []).find((item) => resultMatchesTest(test, item));
        if (result) {
            const artifacts = latestUiArtifactsForResult(runEntry && runEntry.artifacts, result.id);
            return {
                ...summarizeHistoryEntry('ui', result),
                raw: result,
                runByUser: run.runByUser,
                runPath: runEntry && runEntry.paths ? runEntry.paths['Run JSON'] : null,
                resultsPath: runEntry && runEntry.paths ? runEntry.paths['Results JSON'] : null,
                reportPath: runEntry && runEntry.paths ? runEntry.paths['HTML report'] : null,
                artifacts,
                matchSource: 'coverage-last-run-fallback'
            };
        }
    }

    if (source.includes('fuzz')) {
        const runEntry = archiveMap.fuzzRunById.get(lastRunId);
        const run = archiveMap.fuzzRawRunById.get(lastRunId);
        const result = run && (run.fuzzResults || []).find((item) => resultMatchesTest(test, item));
        if (result) {
            return {
                ...summarizeHistoryEntry('fuzz', result),
                raw: result,
                runByUser: run.runByUser,
                runPath: runEntry && runEntry.paths ? runEntry.paths['Run JSON'] : null,
                resultsPath: runEntry && runEntry.paths ? runEntry.paths['Results JSON'] : null,
                reportPath: runEntry && runEntry.paths ? runEntry.paths['Report'] : null,
                matchSource: 'coverage-last-run-fallback'
            };
        }
    }

    return null;
}

function writeLatestEvidenceFiles(archive, manifest, testDir, latest) {
    if (!latest || !latest.raw) return null;
    const latestDir = `${testDir}/latest-evidence`;
    const resultJson = `${latestDir}/result-${latest.resultId}.json`;
    appendJson(archive, resultJson, latest.raw);

    const paths = { 'Result JSON': resultJson };
    if (latest.runPath) paths['Run JSON'] = latest.runPath;
    if (latest.resultsPath) paths['Run results JSON'] = latest.resultsPath;
    if (latest.reportPath) paths['Run report'] = latest.reportPath;

    if (latest.kind === 'api-soap' || latest.kind === 'fuzz') {
        if (latest.raw.request_body) {
            const requestPath = `${latestDir}/request-${latest.resultId}.txt`;
            appendText(archive, requestPath, latest.raw.request_body);
            paths['Request'] = requestPath;
        }
        if (latest.raw.response_body) {
            const responsePath = `${latestDir}/response-${latest.resultId}.txt`;
            appendText(archive, responsePath, latest.raw.response_body);
            paths['Response'] = responsePath;
        }
    }

    if (latest.kind === 'ui') {
        (latest.artifacts || []).forEach((artifact) => {
            paths[artifact.label] = artifact.archivePath;
        });
    }

    const media = latest.kind === 'ui' ? (latest.artifacts || []).map((artifact) => {
        const extension = path.extname(artifact.archivePath || '').toLowerCase();
        const kind = ['.webm', '.mp4', '.mov'].includes(extension) ? 'video' : (isImageArchivePath(artifact.archivePath) ? 'image' : 'file');
        return { label: artifact.label, archivePath: artifact.archivePath, kind };
    }) : [];

    return {
        kind: latest.kind,
        runId: latest.runId,
        resultId: latest.resultId,
        status: latest.status,
        created_at: latest.created_at,
        method: latest.raw.method,
        endpoint: latest.raw.endpoint,
        response_code: latest.raw.response_code,
        request_body: latest.raw.request_body,
        response_body: latest.raw.response_body,
        matchSource: latest.matchSource || 'linked-result',
        media,
        paths
    };
}

function addProjectTestEvidence(archive, manifest, tests, archiveMap) {
    return tests.map((test) => {
        const testDir = `tests/${test.id}-${sanitizePathPart(test.name || 'test')}`;
        const testJson = `${testDir}/test.json`;
        const notesJson = `${testDir}/notes.json`;
        appendJson(archive, testJson, test);
        appendJson(archive, notesJson, test.notes || []);
        const notes = (test.notes || []).map((note) => {
            const attachments = (note.attachments || []).map((attachment) => {
                const fileName = sanitizePathPart(attachment.original_name || attachment.stored_name || `attachment-${attachment.id}`);
                const archivePath = `${testDir}/evidence/note-${note.id}-${attachment.id}-${fileName}`;
                const sourcePath = path.join(projectTestNoteEvidenceDir, path.basename(attachment.stored_name || ''));
                const included = addFileOrDirectory(archive, manifest, sourcePath, archivePath);
                return {
                    id: attachment.id,
                    original_name: attachment.original_name,
                    mime_type: attachment.mime_type,
                    archivePath: included ? archivePath : null,
                    isImage: included && isImageArchivePath(archivePath)
                };
            });
            return {
                id: note.id,
                note: note.note,
                author: displayUser(note.author),
                created_at: note.created_at,
                attachments
            };
        });
        const apiSoapHistory = sortEvidenceResults(test.apiSoapResults).map((result) => {
            const runEntry = archiveMap.apiSoapRunById.get(Number(result.test_run_id));
            return {
                ...summarizeHistoryEntry('api-soap', result),
                raw: result,
                runPath: runEntry && runEntry.paths ? runEntry.paths['Run JSON'] : null,
                resultsPath: runEntry && runEntry.paths ? runEntry.paths['Results JSON'] : null,
                reportPath: runEntry && runEntry.paths ? runEntry.paths['HTML report'] : null
            };
        });
        const uiHistory = sortEvidenceResults(test.uiResults).map((result) => {
            const runEntry = archiveMap.uiRunById.get(Number(result.playwright_run_id));
            const artifacts = latestUiArtifactsForResult(runEntry && runEntry.artifacts, result.id);
            return {
                ...summarizeHistoryEntry('ui', result),
                raw: result,
                runPath: runEntry && runEntry.paths ? runEntry.paths['Run JSON'] : null,
                resultsPath: runEntry && runEntry.paths ? runEntry.paths['Results JSON'] : null,
                reportPath: runEntry && runEntry.paths ? runEntry.paths['HTML report'] : null,
                artifacts
            };
        });
        const fuzzHistory = sortEvidenceResults(test.fuzzResults).map((result) => {
            const runEntry = archiveMap.fuzzRunById.get(Number(result.fuzz_run_id));
            return {
                ...summarizeHistoryEntry('fuzz', result),
                raw: result,
                runPath: runEntry && runEntry.paths ? runEntry.paths['Run JSON'] : null,
                resultsPath: runEntry && runEntry.paths ? runEntry.paths['Results JSON'] : null,
                reportPath: runEntry && runEntry.paths ? runEntry.paths['Report'] : null
            };
        });
        const history = sortEvidenceResults([...apiSoapHistory, ...uiHistory, ...fuzzHistory]);
        const linkedLatest = selectLatestRegisteredEvidence(test, history);
        const selectedLatest = linkedLatest || findLatestCoverageResultFallback(test, archiveMap);
        const latestEvidence = writeLatestEvidenceFiles(archive, manifest, testDir, selectedLatest);
        const lastRunUser = firstRecordedUser(
            test.stats && test.stats.lastRunByUser,
            selectedLatest && selectedLatest.runByUser,
            selectedLatest && selectedLatest.raw && selectedLatest.raw.testRun && selectedLatest.raw.testRun.runByUser,
            selectedLatest && selectedLatest.raw && selectedLatest.raw.playwrightRun && selectedLatest.raw.playwrightRun.runByUser
        );
        return {
            id: test.id,
            name: test.name,
            test_type: test.test_type,
            method: test.method,
            endpoint: test.endpoint,
            stats: test.stats || {},
            lastRunBy: displayUser(lastRunUser),
            ticketUrls: normalizeTicketUrlsList(test),
            paths: { 'Test JSON': testJson, 'Notes JSON': notesJson },
            notes,
            history: history.map(({ raw, artifacts, ...entry }) => entry),
            latestEvidence
        };
    });
}

async function addApiSoapRuns(archive, manifest, runs) {
    const entries = [];
    for (const run of runs) {
        const runDir = `runs/api-soap/run-${run.id}-${sanitizePathPart(run.name || 'run')}`;
        const runJson = `${runDir}/run.json`;
        const resultsJson = `${runDir}/results.json`;
        const reportHtml = `${runDir}/report.html`;
        appendJson(archive, runJson, run);
        appendJson(archive, resultsJson, run.testResults || []);
<<<<<<< HEAD
        let reportPath = null;
        const stableReportPath = getTestRunStableReportPath(run.id);
        const resolvedStableReportPath = resolveAllowedFilePath(stableReportPath);
        if (resolvedStableReportPath && fs.existsSync(resolvedStableReportPath) && addFileOrDirectory(archive, manifest, stableReportPath, reportHtml)) {
            reportPath = reportHtml;
        } else {
            reportPath = await addGeneratedReport(archive, manifest, generateReport, run.id, reportHtml, { skipCache: true });
        }
=======
        const generatedReportPath = await addGeneratedReport(archive, manifest, generateReport, run.id, reportHtml, { skipCache: true });
>>>>>>> origin/main
        entries.push({
            id: run.id,
            name: run.name,
            status: run.status,
            run_type: run.run_type,
            created_at: run.created_at,
            total_tests: run.total_tests,
            passed_tests: run.passed_tests,
            runBy: displayUser(run.runByUser),
            paths: {
                'Run JSON': runJson,
                'Results JSON': resultsJson,
<<<<<<< HEAD
                'HTML report': reportPath
=======
                'HTML report': generatedReportPath
>>>>>>> origin/main
            }
        });
    }
    return entries;
}

async function addPlaywrightRuns(archive, manifest, runs) {
    const entries = [];
    for (const run of runs) {
        const runDir = `runs/ui/run-${run.id}-${sanitizePathPart(run.name || 'run')}`;
        const runJson = `${runDir}/run.json`;
        const resultsJson = `${runDir}/results.json`;
        const reportHtml = `${runDir}/report.html`;
        const artifacts = [];
        appendJson(archive, runJson, run);
        appendJson(archive, resultsJson, run.results || []);
        const generatedReportPath = await addGeneratedReport(archive, manifest, generatePlaywrightReport, run.id, reportHtml);
        if (run.video_path) {
            const archivePath = `${runDir}/artifacts/run-video-${path.basename(run.video_path)}`;
<<<<<<< HEAD
            if (addPlaywrightArtifact(archive, manifest, run.video_path, archivePath, 'video')) artifacts.push({ label: 'Run video recording', archivePath, scope: 'run' });
        }
        if (run.trace_path) {
            const archivePath = `${runDir}/artifacts/run-trace-${path.basename(run.trace_path)}`;
            if (addPlaywrightArtifact(archive, manifest, run.trace_path, archivePath, 'trace')) artifacts.push({ label: 'Run trace', archivePath, scope: 'run' });
=======
            if (addPlaywrightArtifact(archive, manifest, run.video_path, archivePath, 'video')) artifacts.push({ label: 'Run video', archivePath });
        }
        if (run.trace_path) {
            const archivePath = `${runDir}/artifacts/run-trace-${path.basename(run.trace_path)}`;
            if (addPlaywrightArtifact(archive, manifest, run.trace_path, archivePath, 'trace')) artifacts.push({ label: 'Run trace', archivePath });
>>>>>>> origin/main
        }
        (run.results || []).forEach((result) => {
            const resultDir = `${runDir}/artifacts/result-${result.id}`;
            if (result.screenshot_path) {
                const archivePath = `${resultDir}/screenshot-${path.basename(result.screenshot_path)}`;
<<<<<<< HEAD
                if (addPlaywrightArtifact(archive, manifest, result.screenshot_path, archivePath, 'screenshot')) artifacts.push({ label: `Screenshot ${result.id}`, archivePath, resultId: result.id, scope: 'result' });
            }
            if (result.video_path) {
                const archivePath = `${resultDir}/video-${path.basename(result.video_path)}`;
                if (addPlaywrightArtifact(archive, manifest, result.video_path, archivePath, 'video')) artifacts.push({ label: `Video recording ${result.id}`, archivePath, resultId: result.id, scope: 'result' });
            }
            if (result.trace_path) {
                const archivePath = `${resultDir}/trace-${path.basename(result.trace_path)}`;
                if (addPlaywrightArtifact(archive, manifest, result.trace_path, archivePath, 'trace')) artifacts.push({ label: `Trace ${result.id}`, archivePath, resultId: result.id, scope: 'result' });
=======
                if (addPlaywrightArtifact(archive, manifest, result.screenshot_path, archivePath, 'screenshot')) artifacts.push({ label: `Screenshot ${result.id}`, archivePath });
            }
            if (result.video_path) {
                const archivePath = `${resultDir}/video-${path.basename(result.video_path)}`;
                if (addPlaywrightArtifact(archive, manifest, result.video_path, archivePath, 'video')) artifacts.push({ label: `Video ${result.id}`, archivePath });
            }
            if (result.trace_path) {
                const archivePath = `${resultDir}/trace-${path.basename(result.trace_path)}`;
                if (addPlaywrightArtifact(archive, manifest, result.trace_path, archivePath, 'trace')) artifacts.push({ label: `Trace ${result.id}`, archivePath });
>>>>>>> origin/main
            }
        });
        entries.push({
            id: run.id,
            name: run.name,
            status: run.status,
            browser_name: run.browser_name,
            created_at: run.created_at,
            total_tests: run.total_tests,
            passed_tests: run.passed_tests,
            runBy: displayUser(run.runByUser),
            paths: { 'Run JSON': runJson, 'Results JSON': resultsJson, 'HTML report': generatedReportPath },
            artifacts
        });
    }
    return entries;
}

async function addFuzzRuns(archive, manifest, runs) {
    const entries = [];
    for (const run of runs) {
        const runDir = `runs/fuzz/run-${run.id}-${sanitizePathPart(run.name || 'run')}`;
        const runJson = `${runDir}/run.json`;
        const resultsJson = `${runDir}/results.json`;
        const reportHtml = `${runDir}/report.html`;
        appendJson(archive, runJson, run);
        appendJson(archive, resultsJson, run.fuzzResults || []);
        const generatedReportPath = await addGeneratedReport(archive, manifest, generateFuzzReport, run.id, reportHtml, { skipCache: true });
        entries.push({
            id: run.id,
            name: run.name,
            status: run.status,
            apiSpecName: run.apiSpec ? (run.apiSpec.name || run.apiSpec.original_filename || '') : '',
            created_at: run.created_at,
            total_tests: run.total_tests,
            passed_tests: run.passed_tests,
            runBy: displayUser(run.runByUser),
            paths: {
                'Run JSON': runJson,
                'Results JSON': resultsJson,
                'HTML report': generatedReportPath
            }
        });
    }
    return entries;
}

function buildManifest(data, generatedAt) {
    const projectTests = data.projectTests || [];
    const testRuns = data.testRuns || [];
    const playwrightRuns = data.playwrightRuns || [];
    const fuzzRuns = data.fuzzRuns || [];
    return {
        archive_version: 1,
        generated_at: toIso(generatedAt),
        project: {
            id: data.project.id,
            name: data.project.name,
            status: data.project.status || null
        },
        included_sections: [
            'project_metadata',
            'test_catalogue',
            'project_test_notes',
            'note_evidence_images',
            'jira_ticket_links',
            'generated_html_reports',
            'run_by_user_attribution',
            'api_soap_run_history',
            'ui_run_artifacts',
            'fuzz_runs_reports',
            'full_request_response_bodies'
        ],
        counts: {
            api_specs: (data.project.apiSpecs || []).length,
            collections: (data.project.standaloneCollections || []).length + (data.project.apiSpecs || []).reduce((sum, spec) => sum + ((spec.collections || []).length), 0),
            project_tests: projectTests.length,
            project_test_notes: projectTests.reduce((sum, test) => sum + ((test.notes || []).length), 0),
            project_test_note_attachments: projectTests.reduce((sum, test) => sum + (test.notes || []).reduce((noteSum, note) => noteSum + ((note.attachments || []).length), 0), 0),
            api_soap_runs: testRuns.length,
            api_soap_results: testRuns.reduce((sum, run) => sum + ((run.testResults || []).length), 0),
            ui_runs: playwrightRuns.length,
            ui_results: playwrightRuns.reduce((sum, run) => sum + ((run.results || []).length), 0),
            fuzz_runs: fuzzRuns.length,
            fuzz_results: fuzzRuns.reduce((sum, run) => sum + ((run.fuzzResults || []).length), 0)
        },
        included_artifacts: [],
        missing_artifacts: []
    };
}

async function streamProjectAuditArchive(projectId, outputStream) {
    const generatedAt = new Date();
    const data = await loadArchiveData(projectId);
    const manifest = buildManifest(data, generatedAt);
    const archive = createZipArchive({ zlib: { level: 9 } });

    const completion = new Promise((resolve, reject) => {
        outputStream.on('close', resolve);
        outputStream.on('finish', resolve);
        archive.on('warning', (error) => {
            manifest.missing_artifacts.push({ source_path: null, archive_path: null, reason: error.message });
        });
        archive.on('error', reject);
    });

    archive.pipe(outputStream);
    const archiveMap = {
        core: {
            projectJson: 'project.json',
            manifestJson: 'manifest.json',
            catalogueJson: 'tests/catalogue.json',
            catalogueCsv: 'tests/catalogue.csv',
            testsWithNotesJson: 'tests/tests-with-notes.json'
        },
        tests: [],
        apiSoapRuns: [],
        apiSoapRunById: new Map(),
        apiSoapRawRunById: new Map(data.testRuns.map((run) => [Number(run.id), run])),
        uiRuns: [],
        uiRunById: new Map(),
        uiRawRunById: new Map(data.playwrightRuns.map((run) => [Number(run.id), run])),
        fuzzRuns: [],
        fuzzRunById: new Map(),
        fuzzRawRunById: new Map(data.fuzzRuns.map((run) => [Number(run.id), run]))
    };

    appendJson(archive, archiveMap.core.projectJson, data.project);
    appendJson(archive, archiveMap.core.catalogueJson, data.catalogueRows);
    appendText(archive, archiveMap.core.catalogueCsv, catalogueToCsv(data.catalogueRows));
    appendJson(archive, archiveMap.core.testsWithNotesJson, data.projectTests);

    archiveMap.apiSoapRuns = await addApiSoapRuns(archive, manifest, data.testRuns);
<<<<<<< HEAD
    archiveMap.apiSoapRunById = new Map(archiveMap.apiSoapRuns.map((run) => [Number(run.id), run]));
    archiveMap.uiRuns = addPlaywrightRuns(archive, manifest, data.playwrightRuns);
    archiveMap.uiRunById = new Map(archiveMap.uiRuns.map((run) => [Number(run.id), run]));
    archiveMap.fuzzRuns = addFuzzRuns(archive, manifest, data.fuzzRuns);
    archiveMap.fuzzRunById = new Map(archiveMap.fuzzRuns.map((run) => [Number(run.id), run]));
    archiveMap.tests = addProjectTestEvidence(archive, manifest, data.projectTests, archiveMap);
=======
    archiveMap.uiRuns = await addPlaywrightRuns(archive, manifest, data.playwrightRuns);
    archiveMap.fuzzRuns = await addFuzzRuns(archive, manifest, data.fuzzRuns);
    archiveMap.tests = addProjectTestEvidence(archive, manifest, data.projectTests);
    archiveMap.tests = attachRunEvidenceToTests(archiveMap.tests, data, archiveMap);
>>>>>>> origin/main

    appendJson(archive, archiveMap.core.manifestJson, manifest);
    appendText(archive, 'index.html', buildIndexHtml({ project: data.project, generatedAt, manifest, archiveMap }));

    await archive.finalize();
    await completion;
}

module.exports = {
    buildArchiveFilename,
    streamProjectAuditArchive
};