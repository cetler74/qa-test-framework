/**
 * Delete report, video, and trace files when runs or projects are deleted.
 * Uses REPORTS_DIR (env) or ./reports. Does not throw; logs and ignores missing files.
 */
const fs = require('fs');
const path = require('path');

const reportsDir = process.env.REPORTS_DIR || path.join(__dirname, '..', 'reports');
const playwrightVideosDir = path.join(reportsDir, 'playwright-videos');
const playwrightTracesDir = path.join(reportsDir, 'playwright-traces');

function safeUnlink(filePath) {
  if (!filePath || typeof filePath !== 'string') return;
  try {
    const full = path.isAbsolute(filePath) ? filePath : path.join(reportsDir, filePath);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      fs.unlinkSync(full);
    }
  } catch (e) {
    console.warn('artifactCleanup: could not delete file', filePath, e.message);
  }
}

function safeRmDir(dirPath) {
  if (!dirPath || typeof dirPath !== 'string') return;
  try {
    const full = path.isAbsolute(dirPath) ? dirPath : path.join(reportsDir, dirPath);
    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
      fs.rmSync(full, { recursive: true });
    }
  } catch (e) {
    console.warn('artifactCleanup: could not delete dir', dirPath, e.message);
  }
}

/**
 * Delete API test run report file.
 * @param {string|number} testRunId
 */
function deleteTestRunArtifacts(testRunId) {
  const id = typeof testRunId === 'string' ? parseInt(testRunId, 10) : testRunId;
  if (Number.isNaN(id)) return;
  safeUnlink(path.join(reportsDir, `report-test-${id}.html`));
}

/**
 * Delete fuzz run report file and optional CATS output directory.
 * @param {string|number} fuzzRunId
 * @param {string|null} [reportPath] - FuzzRun.report_path (may be absolute path to directory)
 */
function deleteFuzzRunArtifacts(fuzzRunId, reportPath) {
  const id = typeof fuzzRunId === 'string' ? parseInt(fuzzRunId, 10) : fuzzRunId;
  if (Number.isNaN(id)) return;
  safeUnlink(path.join(reportsDir, `report-fuzz-${id}.html`));
  if (reportPath && typeof reportPath === 'string') {
    const full = path.isAbsolute(reportPath) ? reportPath : path.join(reportsDir, reportPath);
    try {
      if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
        fs.rmSync(full, { recursive: true });
      }
    } catch (e) {
      console.warn('artifactCleanup: could not delete fuzz output dir', reportPath, e.message);
    }
  }
}

/**
 * Delete Playwright run and per-result video/trace files, and temp dir.
 * @param {object} run - { id, video_path, trace_path }
 * @param {Array<{ video_path?: string|null, trace_path?: string|null }>} [results]
 */
function deletePlaywrightRunArtifacts(run, results = []) {
  const runId = run && (run.id ?? run);
  if (runId == null) return;
  const videoPath = run.video_path != null ? run.video_path : (run.get && run.get('video_path'));
  const tracePath = run.trace_path != null ? run.trace_path : (run.get && run.get('trace_path'));
  if (videoPath) safeUnlink(path.join(playwrightVideosDir, videoPath));
  if (tracePath) safeUnlink(path.join(playwrightTracesDir, tracePath));
  (results || []).forEach((r) => {
    if (r.video_path) safeUnlink(path.join(playwrightVideosDir, r.video_path));
    if (r.trace_path) safeUnlink(path.join(playwrightTracesDir, r.trace_path));
  });
  const tempDir = path.join(playwrightVideosDir, 'temp', String(runId));
  safeRmDir(tempDir);
}

module.exports = {
  deleteTestRunArtifacts,
  deleteFuzzRunArtifacts,
  deletePlaywrightRunArtifacts
};
