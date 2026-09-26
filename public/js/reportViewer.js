// Report viewing and export functions

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('view-report-btn')?.addEventListener('click', viewReport);
  document.getElementById('download-report-btn')?.addEventListener('click', downloadReport);
});

// View Report – open report URL in new tab (avoids popup blocker; no async before open)
function viewReport() {
  const viewBtn = document.getElementById('view-report-btn');
  const fuzzRunId = viewBtn?.getAttribute('data-fuzz-run-id');
  const testRunId = viewBtn?.getAttribute('data-test-run-id');
  const id = fuzzRunId || testRunId;
  const isFuzz = !!fuzzRunId;

  if (!id) {
    alert('No test run selected');
    return;
  }

  const reportUrl = isFuzz ? `/api/fuzz-runs/${id}/report` : `/api/test-runs/${id}/report`;
  const newWindow = window.open(reportUrl, '_blank', 'noopener,noreferrer');

  if (!newWindow) {
    alert('Popup blocked. Please allow popups for this site, or use "Download Report" to save the report and open it locally.');
  }
}

// Download Report
async function downloadReport() {
  const viewBtn = document.getElementById('view-report-btn');
  const downloadBtn = document.getElementById('download-report-btn');
  const fuzzRunId = downloadBtn?.getAttribute('data-fuzz-run-id') || viewBtn?.getAttribute('data-fuzz-run-id');
  const testRunId = downloadBtn?.getAttribute('data-test-run-id') || viewBtn?.getAttribute('data-test-run-id');
  const id = fuzzRunId || testRunId;
  const isFuzz = !!fuzzRunId;

  if (!id) {
    alert('No test run selected');
    return;
  }

  try {
    const reportUrl = isFuzz ? `/api/fuzz-runs/${id}/report/download` : `/api/test-runs/${id}/report/download`;
    const response = await fetch(reportUrl);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    const blob = await response.blob();

    // Create download link
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = isFuzz ? `fuzz-report-${id}-${Date.now()}.html` : `test-report-${id}-${Date.now()}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    window.trackUsage?.('download_report');
  } catch (error) {
    console.error('Error downloading report:', error);
    alert('Error downloading report: ' + error.message);
  }
}

