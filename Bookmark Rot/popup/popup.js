// Tab switching
const tabs = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');
tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab).classList.add('active');
  });
});

// Clear badge on popup open
chrome.runtime.sendMessage({ type: 'CLEAR_BADGE' }).catch(() => { });

// ===== QUICK FIX =====
const quickFixModal = document.getElementById('quickFixModal');
let lastScanResults = null;

async function loadIssueSummary() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_ISSUE_SUMMARY' });
    if (response.success) {
      const s = response.summary;
      document.getElementById('issueSummary').textContent =
        `${s.duplicates} duplicates, ${s.emptyFolders} empty folders`;
    }
  } catch (e) { console.error(e); }
}

document.getElementById('quickFixBtn').addEventListener('click', async () => {
  quickFixModal.classList.remove('hidden');
  document.querySelectorAll('#quickFixStatus .step').forEach(s => s.classList.remove('active', 'done'));
  document.getElementById('quickFixResults').classList.add('hidden');

  chrome.runtime.onMessage.addListener(function listener(msg) {
    if (msg.type === 'QUICK_FIX_PROGRESS') {
      document.querySelectorAll('#quickFixStatus .step').forEach((s, i) => {
        if (i < msg.step) s.classList.add('done');
        else if (i === msg.step) s.classList.add('active');
        else s.classList.remove('active', 'done');
      });
    }
  });

  const response = await chrome.runtime.sendMessage({ type: 'QUICK_FIX' });
  if (response.success) {
    document.querySelectorAll('#quickFixStatus .step').forEach(s => s.classList.add('done'));
    const r = response.results;
    document.querySelector('.quick-fix-result-grid').innerHTML = `
      <div class="qf-stat"><span class="qf-value">${r.redirectsFixed}</span><span>Redirects Fixed</span></div>
      <div class="qf-stat"><span class="qf-value">${r.brokenMoved}</span><span>Broken Moved</span></div>
      <div class="qf-stat"><span class="qf-value">${r.duplicatesDeleted}</span><span>Duplicates Deleted</span></div>
      <div class="qf-stat"><span class="qf-value">${r.emptyFoldersDeleted}</span><span>Folders Cleaned</span></div>
    `;
    document.getElementById('quickFixResults').classList.remove('hidden');
    loadIssueSummary();
  }
});

document.getElementById('closeQuickFixBtn').addEventListener('click', () => {
  quickFixModal.classList.add('hidden');
});

// ===== SCAN TAB =====
const scanScopeRadios = document.querySelectorAll('input[name="scanScope"]');
const folderPicker = document.getElementById('folderPicker');
const folderSelect = document.getElementById('folderSelect');

scanScopeRadios.forEach(radio => {
  radio.addEventListener('change', () => {
    folderPicker.classList.toggle('hidden', radio.value !== 'folder' || !radio.checked);
    if (radio.value === 'folder') loadFolders();
  });
});

async function loadFolders() {
  const tree = await chrome.bookmarks.getTree();
  const folders = [];
  const extract = (nodes, depth = 0) => {
    for (const n of nodes) {
      if (n.children) { folders.push({ id: n.id, title: '  '.repeat(depth) + (n.title || 'Root') }); extract(n.children, depth + 1); }
    }
  };
  extract(tree);
  folderSelect.innerHTML = folders.map(f => `<option value="${f.id}">${f.title}</option>`).join('');
}

const scanBtn = document.getElementById('scanBtn');
const scanProgress = document.getElementById('scanProgress');
const scanResults = document.getElementById('scanResults');

scanBtn.addEventListener('click', async () => {
  const scope = document.querySelector('input[name="scanScope"]:checked').value;
  const folderId = scope === 'folder' ? folderSelect.value : null;
  scanBtn.disabled = true;
  scanProgress.classList.remove('hidden');
  scanResults.classList.add('hidden');
  updateProgress(scanProgress, 0);

  const response = await chrome.runtime.sendMessage({ type: 'START_SCAN', folderId });
  if (response.success) { lastScanResults = response.results; showScanResults(response.results); }
  scanBtn.disabled = false;
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'SCAN_PROGRESS') updateProgress(scanProgress, msg.current / msg.total, `${msg.current}/${msg.total}`);
  if (msg.type === 'STALE_PROGRESS') updateProgress(document.getElementById('staleProgress'), msg.current / msg.total, `${msg.current}/${msg.total}`);
  if (msg.type === 'DUPLICATE_PROGRESS') updateProgress(document.getElementById('duplicateProgress'), msg.current / msg.total, `${msg.current}/${msg.total}`);
  if (msg.type === 'TITLE_PROGRESS') updateProgress(document.getElementById('titleProgress'), msg.current / msg.total, `${msg.current}/${msg.total}`);
});

function updateProgress(container, percent, text) {
  container.querySelector('.progress-fill').style.width = `${percent * 100}%`;
  if (text) container.querySelector('.progress-text span').textContent = text;
}

function showScanResults(results) {
  scanProgress.classList.add('hidden');
  scanResults.classList.remove('hidden');
  document.getElementById('fixedCount').textContent = results.fixed.length;
  document.getElementById('brokenCount').textContent = results.broken.length;
  document.getElementById('unchangedCount').textContent = results.unchanged;
  document.getElementById('waybackBtn').disabled = results.broken.length === 0;

  const html = [
    ...results.fixed.map(b => `<div class="result-item fixed"><div class="result-item-title">${esc(b.title)}</div><div class="result-item-url">${esc(b.oldUrl)} → ${esc(b.newUrl)}</div></div>`),
    ...results.broken.map(b => `<div class="result-item broken"><div class="result-item-title">${esc(b.title)}</div><div class="result-item-url">${esc(b.url)}</div></div>`)
  ].join('');
  document.getElementById('resultDetails').innerHTML = html || '<p class="empty-state">All good! 🎉</p>';
}

// Wayback Machine
document.getElementById('waybackBtn').addEventListener('click', async () => {
  if (!lastScanResults || !lastScanResults.broken.length) return;
  const btn = document.getElementById('waybackBtn');
  btn.disabled = true;
  btn.textContent = '⏳';

  const response = await chrome.runtime.sendMessage({ type: 'FIND_ARCHIVED', brokenBookmarks: lastScanResults.broken });
  if (response.success && response.results.length > 0) {
    alert(`Found ${response.results.length} archived versions! Check the Wayback Machine.`);
  } else {
    alert('No archived versions found.');
  }
  btn.textContent = '🏛️';
  btn.disabled = false;
});

document.getElementById('exportScanBtn').addEventListener('click', () => { if (lastScanResults) exportData(lastScanResults, 'scan'); });

// ===== DUPLICATES TAB =====
let currentDuplicates = [];
document.getElementById('findDuplicatesBtn').addEventListener('click', async () => {
  const btn = document.getElementById('findDuplicatesBtn');
  btn.disabled = true;
  document.getElementById('duplicateProgress').classList.remove('hidden');
  document.getElementById('duplicateResults').classList.add('hidden');

  const response = await chrome.runtime.sendMessage({ type: 'FIND_DUPLICATES' });
  if (response.success) { currentDuplicates = response.duplicates; showDuplicates(currentDuplicates); }
  btn.disabled = false;
  document.getElementById('duplicateProgress').classList.add('hidden');
});

function showDuplicates(dupes) {
  document.getElementById('duplicateResults').classList.remove('hidden');
  document.getElementById('duplicateCount').textContent = dupes.length;
  document.getElementById('deleteAllDuplicatesBtn').disabled = dupes.length === 0;
  document.getElementById('duplicateList').innerHTML = dupes.length ? dupes.slice(0, 20).map(g => `
    <div class="duplicate-group"><div class="duplicate-url">${esc(g.url)}</div><div class="duplicate-count">${g.count} copies</div></div>
  `).join('') : '<p class="empty-state">No duplicates! 🎉</p>';
}

document.getElementById('deleteAllDuplicatesBtn').addEventListener('click', async () => {
  if (!confirm(`Delete ${currentDuplicates.reduce((s, g) => s + g.count - 1, 0)} duplicates?`)) return;
  await chrome.runtime.sendMessage({ type: 'DELETE_DUPLICATES', groups: currentDuplicates });
  currentDuplicates = []; showDuplicates([]);
});

document.getElementById('exportDuplicatesBtn').addEventListener('click', () => { if (currentDuplicates.length) exportData(currentDuplicates, 'duplicates'); });

// ===== STALE TAB =====
let currentStale = [];
document.getElementById('findStaleBtn').addEventListener('click', async () => {
  const days = parseInt(document.getElementById('stalePeriod').value);
  document.getElementById('findStaleBtn').disabled = true;
  document.getElementById('staleProgress').classList.remove('hidden');
  document.getElementById('staleResults').classList.add('hidden');

  const response = await chrome.runtime.sendMessage({ type: 'FIND_STALE', days });
  if (response.success) { currentStale = response.staleBookmarks; showStale(currentStale); }
  document.getElementById('findStaleBtn').disabled = false;
  document.getElementById('staleProgress').classList.add('hidden');
});

function showStale(bookmarks) {
  document.getElementById('staleResults').classList.remove('hidden');
  document.getElementById('staleCount').textContent = bookmarks.length;
  document.getElementById('staleList').innerHTML = bookmarks.length ? bookmarks.slice(0, 30).map(b => `
    <div class="stale-item"><input type="checkbox" class="stale-checkbox" data-id="${b.id}">
    <div class="stale-item-info"><div class="stale-item-title">${esc(b.title || 'Untitled')}</div></div>
    <div class="stale-item-days">${b.daysSinceAccess}d</div></div>
  `).join('') : '<p class="empty-state">No stale bookmarks! 🎉</p>';
  updateStaleBtn();
}

document.getElementById('staleList').addEventListener('change', updateStaleBtn);
document.getElementById('selectAllStale').addEventListener('change', e => {
  document.querySelectorAll('.stale-checkbox').forEach(cb => cb.checked = e.target.checked);
  updateStaleBtn();
});

function updateStaleBtn() {
  const count = document.querySelectorAll('.stale-checkbox:checked').length;
  const btn = document.getElementById('deleteSelectedBtn');
  btn.disabled = count === 0;
  btn.textContent = count ? `🗑️ (${count})` : '🗑️ Delete';
}

document.getElementById('deleteSelectedBtn').addEventListener('click', async () => {
  const ids = [...document.querySelectorAll('.stale-checkbox:checked')].map(cb => cb.dataset.id);
  if (!ids.length || !confirm(`Delete ${ids.length} bookmarks?`)) return;
  await chrome.runtime.sendMessage({ type: 'DELETE_BOOKMARKS', ids });
  currentStale = currentStale.filter(b => !ids.includes(b.id));
  showStale(currentStale);
  document.getElementById('selectAllStale').checked = false;
});

document.getElementById('exportStaleBtn').addEventListener('click', () => { if (currentStale.length) exportData(currentStale, 'stale'); });

// ===== TOOLS: BACKUP =====
async function loadBackups() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_BACKUPS' });
  if (response.success) {
    const list = document.getElementById('backupList');
    list.innerHTML = response.backups.length ? response.backups.map(b => `
      <div class="backup-item">
        <div class="backup-info"><strong>${b.label}</strong><br><small>${new Date(b.date).toLocaleDateString()} · ${b.bookmarkCount} bookmarks</small></div>
        <button class="btn-icon restore-btn" data-id="${b.id}" title="Restore">↩️</button>
      </div>
    `).join('') : '<p class="empty-state">No backups yet</p>';
  }
}

document.getElementById('createBackupBtn').addEventListener('click', async () => {
  const btn = document.getElementById('createBackupBtn');
  btn.disabled = true; btn.textContent = 'Creating...';
  await chrome.runtime.sendMessage({ type: 'CREATE_BACKUP', label: 'Manual backup' });
  await loadBackups();
  btn.disabled = false; btn.textContent = 'Create Backup';
});

document.getElementById('backupList').addEventListener('click', async e => {
  const restoreBtn = e.target.closest('.restore-btn');
  if (restoreBtn && confirm('Restore this backup? Current bookmarks will be replaced.')) {
    restoreBtn.disabled = true;
    await chrome.runtime.sendMessage({ type: 'RESTORE_BACKUP', backupId: restoreBtn.dataset.id });
    alert('Backup restored!');
    restoreBtn.disabled = false;
  }
});

// ===== TOOLS: TITLES =====
let currentBadTitles = [];
document.getElementById('findBadTitlesBtn').addEventListener('click', async () => {
  const btn = document.getElementById('findBadTitlesBtn');
  btn.disabled = true;
  document.getElementById('titleProgress').classList.remove('hidden');
  document.getElementById('titleResults').classList.add('hidden');

  const response = await chrome.runtime.sendMessage({ type: 'FIND_BAD_TITLES' });
  if (response.success) {
    currentBadTitles = response.badTitles;
    document.getElementById('badTitleCount').textContent = currentBadTitles.length;
    document.getElementById('fixTitlesBtn').disabled = currentBadTitles.length === 0;
    document.getElementById('titleResults').classList.remove('hidden');
  }
  btn.disabled = false;
  document.getElementById('titleProgress').classList.add('hidden');
});

document.getElementById('fixTitlesBtn').addEventListener('click', async () => {
  if (!confirm(`Fix ${currentBadTitles.length} titles?`)) return;
  const btn = document.getElementById('fixTitlesBtn');
  btn.disabled = true; btn.textContent = '⏳ Fixing...';
  const response = await chrome.runtime.sendMessage({ type: 'FIX_TITLES', bookmarks: currentBadTitles });
  btn.textContent = response.success ? `✓ Fixed ${response.results.fixed.length}` : '❌ Error';
});

// ===== TOOLS: EMPTY FOLDERS =====
let currentEmptyFolders = [];
document.getElementById('findEmptyFoldersBtn').addEventListener('click', async () => {
  const btn = document.getElementById('findEmptyFoldersBtn');
  btn.disabled = true;
  const response = await chrome.runtime.sendMessage({ type: 'FIND_EMPTY_FOLDERS' });
  if (response.success) {
    currentEmptyFolders = response.folders;
    document.getElementById('emptyFolderCount').textContent = currentEmptyFolders.length;
    document.getElementById('deleteEmptyFoldersBtn').disabled = currentEmptyFolders.length === 0;
    document.getElementById('emptyFolderResults').classList.remove('hidden');
  }
  btn.disabled = false;
});

document.getElementById('deleteEmptyFoldersBtn').addEventListener('click', async () => {
  if (!confirm(`Delete ${currentEmptyFolders.length} empty folders?`)) return;
  await chrome.runtime.sendMessage({ type: 'DELETE_EMPTY_FOLDERS', ids: currentEmptyFolders.map(f => f.id) });
  currentEmptyFolders = [];
  document.getElementById('emptyFolderCount').textContent = '0';
  document.getElementById('deleteEmptyFoldersBtn').disabled = true;
});

// ===== TOOLS: SCHEDULE =====
async function loadScheduleSettings() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_SCHEDULE' });
  document.getElementById('scheduleInterval').value = response.intervalDays || 0;
  if (response.lastScan) {
    document.getElementById('lastScanInfo').textContent = `Last: ${new Date(response.lastScan.timestamp).toLocaleDateString()}`;
    document.getElementById('lastScanInfo').classList.remove('hidden');
  }
}

document.getElementById('saveScheduleBtn').addEventListener('click', async () => {
  const days = parseInt(document.getElementById('scheduleInterval').value);
  await chrome.runtime.sendMessage({ type: 'SET_SCHEDULE', days });
  const btn = document.getElementById('saveScheduleBtn');
  btn.textContent = '✓'; setTimeout(() => btn.textContent = 'Save', 1500);
});

// ===== TOOLS: SETTINGS =====
async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  if (settings) {
    document.getElementById('skipSpecialUrls').checked = settings.skipSpecialUrls ?? true;
    document.getElementById('autoCreateBrokenFolder').checked = settings.autoCreateBrokenFolder ?? true;
  }
}

document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
  await chrome.storage.local.set({
    settings: {
      skipSpecialUrls: document.getElementById('skipSpecialUrls').checked,
      autoCreateBrokenFolder: document.getElementById('autoCreateBrokenFolder').checked,
      concurrentRequests: 5
    }
  });
  const btn = document.getElementById('saveSettingsBtn');
  btn.textContent = '✓'; setTimeout(() => btn.textContent = '💾 Save', 1500);
});

// ===== HELPERS =====
async function exportData(data, type) {
  const format = prompt('Format? (csv or json)', 'csv');
  if (format) await chrome.runtime.sendMessage({ type: 'EXPORT', data, dataType: type, format: format.toLowerCase() });
}

function esc(text) { const d = document.createElement('div'); d.textContent = text || ''; return d.innerHTML; }

// Init
loadSettings();
loadScheduleSettings();
loadBackups();
loadIssueSummary();
