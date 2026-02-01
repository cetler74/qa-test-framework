// Report viewing and export functions

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('view-report-btn')?.addEventListener('click', viewReport);
  document.getElementById('download-report-btn')?.addEventListener('click', downloadReport);
});

// View Report
async function viewReport() {
  const viewBtn = document.getElementById('view-report-btn');
  const fuzzRunId = viewBtn?.getAttribute('data-fuzz-run-id');
  const testRunId = viewBtn?.getAttribute('data-test-run-id');
  const id = fuzzRunId || testRunId;
  const isFuzz = !!fuzzRunId;

  if (!id) {
    alert('No test run selected');
    return;
  }

  try {
    const reportUrl = isFuzz ? `/api/fuzz-runs/${id}/report` : `/api/test-runs/${id}/report`;
    const response = await fetch(reportUrl);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
    }
    
    const html = await response.text();
    
    // Open in new window
    const newWindow = window.open('', '_blank');
    
    if (!newWindow) {
      // Popup blocked - fallback to downloading instead
      alert('Popup blocked. The report will be downloaded instead.');
      downloadReport();
      return;
    }
    
    newWindow.document.write(html);
    newWindow.document.close();
  } catch (error) {
    console.error('Error loading report:', error);
    alert('Error loading report: ' + error.message);
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
  } catch (error) {
    console.error('Error downloading report:', error);
    alert('Error downloading report: ' + error.message);
  }
}

