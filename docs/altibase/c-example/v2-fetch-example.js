/* Integration fragment for UST_Holders_v2.html; not a standalone replacement.
 * Keep the existing browser JavaScript/Vue. C-only applies to server programs.
 * Move ALL existing initialization after the tic-data read into startDashboard.
 */
async function loadUstDashboard(startDashboard, showLoading, showError) {
  showLoading();
  try {
    const response = await fetch('/api/ust-holders/v2/data', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {Accept: 'application/json'},
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!(response.headers.get('content-type') || '').includes('application/json')) {
      throw new Error('Unexpected response type');
    }
    const data = await response.json();
    if (data.meta?.schema_version !== 2 || !data.meta.dataset_id ||
        !Array.isArray(data.countries) || !Array.isArray(data.months) ||
        !Array.isArray(data.records) || !data.records.length ||
        data.records.some(row => !Array.isArray(row) || row.length !== 10)) {
      throw new Error('Invalid UST response');
    }
    // startDashboard must dispose/update the existing Vue instance on reload.
    // Serialize reloads or cancel old requests so an older response cannot win.
    startDashboard(data);
  } catch (error) {
    showError('자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
}
