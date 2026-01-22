// Report viewing and export functions

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('view-report-btn')?.addEventListener('click', viewReport);
  document.getElementById('download-report-btn')?.addEventListener('click', downloadReport);
});

// View Report
async function viewReport() {
  const testRunId = document.getElementById('view-report-btn')?.getAttribute('data-test-run-id');
  
  if (!testRunId) {
    alert('No test run selected');
    return;
  }
  
  try {
    const response = await fetch(`/api/test-runs/${testRunId}/report`);
    
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
  const testRunId = document.getElementById('download-report-btn')?.getAttribute('data-test-run-id') || 
                    document.getElementById('view-report-btn')?.getAttribute('data-test-run-id');
  
  if (!testRunId) {
    alert('No test run selected');
    return;
  }
  
  try {
    const response = await fetch(`/api/test-runs/${testRunId}/report/download`);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
    }
    
    const blob = await response.blob();
    
    // Create download link
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `test-report-${testRunId}-${Date.now()}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Error downloading report:', error);
    alert('Error downloading report: ' + error.message);
  }
}

