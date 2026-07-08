const fs = require('fs');
const path = require('path');
const { ZipArchive } = require('archiver');
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
const { getStableReportPath: getTestRunStableReportPath } = require('./reportGenerator');
const { normalizeTicketUrlsList, ticketUrlsToCsvCell } = require('../lib/ticketUrls');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR || path.join(PROJECT_ROOT, 'uploads'));
const REPORTS_ROOT = path.resolve(process.env.REPORTS_DIR || path.join(PROJECT_ROOT, 'reports'));
const NOTE_EVIDENCE_ROOT = path.resolve(projectTestNoteEvidenceDir);
const ALLOWED_FILE_ROOTS = [UPLOAD_ROOT, REPORTS_ROOT, NOTE_EVIDENCE_ROOT];

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

        const testRows = tests.length ? tests.map((test) => {
                const stats = test.stats || {};
                const notesHtml = test.notes.length ? test.notes.map((note) => {
                        const attachments = note.attachments.length ? note.attachments.map((attachment) => {
                                const image = attachment.archivePath && attachment.isImage
                                        ? `<a href="${escapeHtml(attachment.archivePath)}"><img src="${escapeHtml(attachment.archivePath)}" alt="${escapeHtml(attachment.original_name || 'Evidence image')}"></a>`
                                        : '';
                                return `<div class="evidence-item">${image}${archiveLink(attachment.archivePath, attachment.original_name || `Attachment ${attachment.id}`)}</div>`;
                        }).join('') : '<p class="muted">No evidence images.</p>';
                        return `<div class="note-card"><div class="note-meta">Note ${escapeHtml(note.id)} - ${escapeHtml(toIso(note.created_at) || '')}</div><p>${escapeHtml(note.note || '')}</p><div class="evidence-grid">${attachments}</div></div>`;
                }).join('') : '<p class="muted">No notes recorded.</p>';
                return `<tr>
                        <td><strong>${escapeHtml(test.name)}</strong><div class="muted">${escapeHtml(test.test_type || '')}${test.method ? ` - ${escapeHtml(test.method)}` : ''}</div></td>
                        <td><span class="status ${statusClass(stats.last_status)}">${escapeHtml(stats.last_status || 'not_run')}</span></td>
                        <td>${escapeHtml(toIso(stats.last_run_at) || 'Not run')}</td>
                        <td>${escapeHtml(test.lastRunBy || 'Not recorded')}</td>
                        <td>${ticketLinks(test.ticketUrls)}</td>
                        <td>${detailLinks(test.paths)}</td>
                </tr>
                <tr class="notes-row"><td colspan="6">${notesHtml}</td></tr>`;
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
                        <td>Not recorded</td>
                        <td>${escapeHtml(`${run.passed_tests || 0}/${run.total_tests || 0} passed`)}</td>
                        <td>${detailLinks(run.paths)} ${artifacts}</td>
                </tr>`;
        }).join('') : '<tr><td colspan="6">No UI runs were archived.</td></tr>';

        const fuzzRows = fuzzRuns.length ? fuzzRuns.map((run) => `<tr>
                <td><strong>${escapeHtml(run.name)}</strong><div class="muted">${escapeHtml(run.apiSpecName || '')}</div></td>
                <td><span class="status ${statusClass(run.status)}">${escapeHtml(run.status || '')}</span></td>
                <td>${escapeHtml(toIso(run.created_at) || '')}</td>
                <td>Not recorded</td>
                <td>${escapeHtml(`${run.passed_tests || 0}/${run.total_tests || 0} passed`)}</td>
                <td>${detailLinks(run.paths)}</td>
        </tr>`).join('') : '<tr><td colspan="6">No fuzz runs were archived.</td></tr>';

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(project.name)} Audit Archive</title>
  <style>
        :root { --ink: #1f2937; --muted: #6b7280; --line: #d1d5db; --panel: #ffffff; --soft: #f3f4f6; --brand: #0f766e; --brand-dark: #134e4a; }
        body { margin: 0; font-family: Arial, sans-serif; color: var(--ink); background: #eef2f7; line-height: 1.5; }
        .page { max-width: 1180px; margin: 0 auto; padding: 32px; }
        .header { background: linear-gradient(135deg, var(--brand-dark), var(--brand)); color: #fff; padding: 28px 32px; border-radius: 10px; box-shadow: 0 10px 24px rgba(15, 118, 110, .18); }
        .header h1 { margin: 0 0 6px; font-size: 30px; }
        .header p { margin: 0; opacity: .92; }
        .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 14px; margin: 20px 0; }
        .summary-card { background: var(--panel); border-radius: 8px; border-top: 4px solid var(--brand); padding: 14px 16px; box-shadow: 0 2px 8px rgba(15, 23, 42, .08); }
        .summary-card span { display: block; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
        .summary-card strong { display: block; font-size: 28px; margin-top: 4px; }
        .section { background: var(--panel); border-radius: 8px; padding: 22px; margin: 18px 0; box-shadow: 0 2px 8px rgba(15, 23, 42, .08); }
        .section h2 { margin: 0 0 12px; font-size: 20px; }
        table { border-collapse: collapse; width: 100%; margin-top: 12px; }
        th, td { border: 1px solid var(--line); padding: 9px 10px; text-align: left; vertical-align: top; }
        th { background: var(--soft); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
        a { color: #0f766e; font-weight: 600; text-decoration: none; }
        a:hover { text-decoration: underline; }
        code { background: var(--soft); padding: 2px 4px; border-radius: 4px; }
        .muted { color: var(--muted); font-size: 13px; }
        .small-link { display: inline-block; margin: 0 6px 6px 0; padding: 4px 8px; border: 1px solid var(--line); border-radius: 999px; background: #fff; font-size: 12px; }
        .status { display: inline-block; padding: 3px 9px; border-radius: 999px; font-size: 12px; font-weight: 700; text-transform: uppercase; }
        .status.passed { background: #dcfce7; color: #166534; }
        .status.failed { background: #fee2e2; color: #991b1b; }
        .status.running { background: #dbeafe; color: #1d4ed8; }
        .status.cancelled { background: #fef3c7; color: #92400e; }
        .status.not-run { background: #e5e7eb; color: #374151; }
        .notes-row td { background: #fafafa; }
        .note-card { border: 1px solid var(--line); border-radius: 8px; padding: 12px; margin: 10px 0; background: #fff; }
        .note-meta { color: var(--muted); font-size: 12px; font-weight: 700; text-transform: uppercase; }
        .evidence-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-top: 10px; }
        .evidence-item { border: 1px solid var(--line); border-radius: 8px; padding: 8px; background: #fff; }
        .evidence-item img { display: block; max-width: 100%; max-height: 180px; object-fit: contain; margin-bottom: 8px; border-radius: 6px; border: 1px solid #e5e7eb; }
        .file-grid { display: flex; flex-wrap: wrap; gap: 8px; }
  </style>
</head>
<body>
    <div class="page">
        <header class="header">
            <h1>${escapeHtml(project.name)} Audit Archive</h1>
            <p>Generated at ${escapeHtml(toIso(generatedAt))} - Project ID ${escapeHtml(project.id)}</p>
        </header>
        <div class="summary">${summaryCards}</div>

        <section class="section">
            <h2>Archive Files</h2>
            <div class="file-grid">
                ${archiveLink(archiveMap.core.projectJson, 'Project JSON', 'small-link')}
                ${archiveLink(archiveMap.core.manifestJson, 'Manifest JSON', 'small-link')}
                ${archiveLink(archiveMap.core.catalogueCsv, 'Tests CSV', 'small-link')}
                ${archiveLink(archiveMap.core.catalogueJson, 'Tests JSON', 'small-link')}
                ${archiveLink(archiveMap.core.testsWithNotesJson, 'Tests with notes JSON', 'small-link')}
            </div>
        </section>

        <section class="section">
            <h2>Tests, Notes, Evidence, and Jira Links</h2>
            <table>
                <thead><tr><th>Test</th><th>Status</th><th>Last run</th><th>Last run by</th><th>Tickets</th><th>Files</th></tr></thead>
                <tbody>${testRows}</tbody>
            </table>
        </section>

        <section class="section">
            <h2>API/SOAP Run Evidence</h2>
            <table>
                <thead><tr><th>Run</th><th>Status</th><th>Created</th><th>Run by</th><th>Result</th><th>Files</th></tr></thead>
                <tbody>${apiRows}</tbody>
            </table>
        </section>

        <section class="section">
            <h2>UI Run Evidence</h2>
            <table>
                <thead><tr><th>Run</th><th>Status</th><th>Created</th><th>Run by</th><th>Result</th><th>Files</th></tr></thead>
                <tbody>${uiRows}</tbody>
            </table>
        </section>

        <section class="section">
            <h2>Fuzz Run Evidence</h2>
            <table>
                <thead><tr><th>Run</th><th>Status</th><th>Created</th><th>Run by</th><th>Result</th><th>Files</th></tr></thead>
                <tbody>${fuzzRows}</tbody>
            </table>
        </section>

        <section class="section">
            <h2>Missing Artifacts</h2>
            <table>
                <thead><tr><th>Archive path</th><th>Reason</th><th>Source path</th></tr></thead>
                <tbody>${missingRows}</tbody>
            </table>
        </section>
    </div>
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
                    include: [{ model: ProjectTestNoteAttachment, as: 'attachments', required: false }]
                }
            ],
            order: [
                ['source_order', 'ASC'],
                ['id', 'ASC'],
                [{ model: ProjectTestNote, as: 'notes' }, 'created_at', 'ASC'],
                [{ model: ProjectTestNote, as: 'notes' }, { model: ProjectTestNoteAttachment, as: 'attachments' }, 'created_at', 'ASC']
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
            include: [{ model: PlaywrightResult, as: 'results', required: false }],
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

function addProjectTestEvidence(archive, manifest, tests) {
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
                created_at: note.created_at,
                attachments
            };
        });
        return {
            id: test.id,
            name: test.name,
            test_type: test.test_type,
            method: test.method,
            endpoint: test.endpoint,
            stats: test.stats || {},
            lastRunBy: displayUser(test.stats && test.stats.lastRunByUser),
            ticketUrls: normalizeTicketUrlsList(test),
            paths: { 'Test JSON': testJson, 'Notes JSON': notesJson },
            notes
        };
    });
}

function addApiSoapRuns(archive, manifest, runs) {
    return runs.map((run) => {
        const runDir = `runs/api-soap/run-${run.id}-${sanitizePathPart(run.name || 'run')}`;
        const runJson = `${runDir}/run.json`;
        const resultsJson = `${runDir}/results.json`;
        const reportHtml = `${runDir}/report.html`;
        appendJson(archive, runJson, run);
        appendJson(archive, resultsJson, run.testResults || []);
        const reportIncluded = addFileOrDirectory(archive, manifest, getTestRunStableReportPath(run.id), reportHtml);
        return {
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
                'HTML report': reportIncluded ? reportHtml : null
            }
        };
    });
}

function addPlaywrightRuns(archive, manifest, runs) {
    return runs.map((run) => {
        const runDir = `runs/ui/run-${run.id}-${sanitizePathPart(run.name || 'run')}`;
        const runJson = `${runDir}/run.json`;
        const resultsJson = `${runDir}/results.json`;
        const artifacts = [];
        appendJson(archive, runJson, run);
        appendJson(archive, resultsJson, run.results || []);
        if (run.video_path) {
            const archivePath = `${runDir}/artifacts/run-video-${path.basename(run.video_path)}`;
            if (addFileOrDirectory(archive, manifest, run.video_path, archivePath)) artifacts.push({ label: 'Run video', archivePath });
        }
        if (run.trace_path) {
            const archivePath = `${runDir}/artifacts/run-trace-${path.basename(run.trace_path)}`;
            if (addFileOrDirectory(archive, manifest, run.trace_path, archivePath)) artifacts.push({ label: 'Run trace', archivePath });
        }
        (run.results || []).forEach((result) => {
            const resultDir = `${runDir}/artifacts/result-${result.id}`;
            if (result.screenshot_path) {
                const archivePath = `${resultDir}/screenshot-${path.basename(result.screenshot_path)}`;
                if (addFileOrDirectory(archive, manifest, result.screenshot_path, archivePath)) artifacts.push({ label: `Screenshot ${result.id}`, archivePath });
            }
            if (result.video_path) {
                const archivePath = `${resultDir}/video-${path.basename(result.video_path)}`;
                if (addFileOrDirectory(archive, manifest, result.video_path, archivePath)) artifacts.push({ label: `Video ${result.id}`, archivePath });
            }
            if (result.trace_path) {
                const archivePath = `${resultDir}/trace-${path.basename(result.trace_path)}`;
                if (addFileOrDirectory(archive, manifest, result.trace_path, archivePath)) artifacts.push({ label: `Trace ${result.id}`, archivePath });
            }
        });
        return {
            id: run.id,
            name: run.name,
            status: run.status,
            browser_name: run.browser_name,
            created_at: run.created_at,
            total_tests: run.total_tests,
            passed_tests: run.passed_tests,
            paths: { 'Run JSON': runJson, 'Results JSON': resultsJson },
            artifacts
        };
    });
}

function addFuzzRuns(archive, manifest, runs) {
    return runs.map((run) => {
        const runDir = `runs/fuzz/run-${run.id}-${sanitizePathPart(run.name || 'run')}`;
        const runJson = `${runDir}/run.json`;
        const resultsJson = `${runDir}/results.json`;
        const reportPath = `${runDir}/report`;
        appendJson(archive, runJson, run);
        appendJson(archive, resultsJson, run.fuzzResults || []);
        const reportIncluded = run.report_path ? addFileOrDirectory(archive, manifest, run.report_path, reportPath) : false;
        return {
            id: run.id,
            name: run.name,
            status: run.status,
            apiSpecName: run.apiSpec ? (run.apiSpec.name || run.apiSpec.original_filename || '') : '',
            created_at: run.created_at,
            total_tests: run.total_tests,
            passed_tests: run.passed_tests,
            paths: {
                'Run JSON': runJson,
                'Results JSON': resultsJson,
                'Report': reportIncluded ? reportPath : null
            }
        };
    });
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
    const archive = new ZipArchive({ zlib: { level: 9 } });

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
        uiRuns: [],
        fuzzRuns: []
    };

    appendJson(archive, archiveMap.core.projectJson, data.project);
    appendJson(archive, archiveMap.core.catalogueJson, data.catalogueRows);
    appendText(archive, archiveMap.core.catalogueCsv, catalogueToCsv(data.catalogueRows));
    appendJson(archive, archiveMap.core.testsWithNotesJson, data.projectTests);

    archiveMap.tests = addProjectTestEvidence(archive, manifest, data.projectTests);
    archiveMap.apiSoapRuns = addApiSoapRuns(archive, manifest, data.testRuns);
    archiveMap.uiRuns = addPlaywrightRuns(archive, manifest, data.playwrightRuns);
    archiveMap.fuzzRuns = addFuzzRuns(archive, manifest, data.fuzzRuns);

    appendJson(archive, archiveMap.core.manifestJson, manifest);
    appendText(archive, 'index.html', buildIndexHtml({ project: data.project, generatedAt, manifest, archiveMap }));

    await archive.finalize();
    await completion;
}

module.exports = {
    buildArchiveFilename,
    streamProjectAuditArchive
};