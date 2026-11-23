/* ChromaBook Studio Frontend Application — 100% English LTR */

const VIEW_TITLES = {
  dashboard: 'Dashboard',
  inbox: 'Artwork Inbox',
  library: 'Artwork Library',
  projects: 'Projects',
  lab: 'Processing Lab',
  books: 'Books',
  history: 'Processing History',
  audit: 'Audit Log',
  status: 'System Status',
};

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ALLOWED_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp']);

const state = {
  currentView: 'inbox',
  user: null,
  dashboard: null,
  projects: [],
  assets: [],
  books: [],
  runs: [],
  audit: [],
  systemStatus: null,
  mappingMeta: null,
  selectedInboxIds: new Set(),
  selectedLibraryIds: new Set(),
  selectedProjectAssetIds: new Set(),
  selectedProjectId: null,
  selectedLabAssetId: '',
  labDirty: false,
  labTouchedKeys: new Set(),
  assignTab: 'existing',
  assignTargetIds: [],
  reviewTarget: null,
  confirmAction: null,
  pollTimer: null,
  blobCache: new Map(),
  uploadProcessQueue: [],
  uploadProcessActive: 0,
  uploadRowMap: new Map(),
};

const MAX_AUTO_PROCESS_CONCURRENCY = 2;
const LS_AUTO_PROCESS_KEY = 'chromabook_auto_process';
const LS_UPLOAD_PRESET_KEY = 'chromabook_upload_preset';

window.labDirty = false;

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
}

function fmtBytes(bytes) {
  if (bytes === null || bytes === undefined || Number.isNaN(Number(bytes))) return '—';
  const b = Number(bytes);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
}

function fmtNum(val, digits = 2) {
  if (val === null || val === undefined || Number.isNaN(Number(val))) return '—';
  return Number(val).toFixed(digits);
}

function statusLabel(status) {
  const map = {
    uploaded: 'Uploaded',
    processing: 'Processing',
    review: 'In Review',
    approved: 'Approved',
    rejected: 'Rejected',
    failed: 'Failed',
    queued: 'Queued',
    running: 'Running',
    completed: 'Completed',
    building: 'Building',
    ready: 'Ready',
    empty: 'Empty',
    in_progress: 'In Progress',
    ready_for_book: 'Ready for Book',
  };
  return map[status] || String(status || 'Unknown');
}

function showToast(message, isError = false) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.style.background = isError ? '#991b1b' : '#0f172a';
  el.style.display = 'block';
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    el.style.display = 'none';
  }, 4200);
}

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const resp = await fetch(url, { ...options, headers });
  const text = await resp.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!resp.ok) {
    throw new Error(data?.detail || `Request failed (${resp.status})`);
  }
  return data;
}

async function fetchBlobUrl(url) {
  if (!url) return null;
  if (state.blobCache.has(url)) {
    return state.blobCache.get(url);
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to load resource (${resp.status})`);
  const blob = await resp.blob();
  const objUrl = URL.createObjectURL(blob);
  state.blobCache.set(url, objUrl);
  return objUrl;
}

function hydrateImages(container) {
  if (!container) return;
  const imgs = container.querySelectorAll('img[data-image-src]');
  imgs.forEach(async (img) => {
    const src = img.getAttribute('data-image-src');
    if (!src) return;
    try {
      const objUrl = await fetchBlobUrl(src);
      if (objUrl && document.body.contains(img)) {
        img.src = objUrl;
      }
    } catch {
      // Keep clean neutral background if unavailable
    }
  });
}

async function downloadFile(url, filename) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      let msg = `Download failed (${resp.status})`;
      try {
        const j = await resp.json();
        if (j?.detail) msg = j.detail;
      } catch {
        // ignore parse failure
      }
      throw new Error(msg);
    }
    const blob = await resp.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
  } catch (err) {
    showToast(err.message || 'Failed to download file.', true);
  }
}

// --- Navigation & Shell ---

function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  if (sb) sb.classList.toggle('open');
}

function navigate(view) {
  if (!VIEW_TITLES[view]) view = 'inbox';
  state.currentView = view;

  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-view') === view);
  });
  document.querySelectorAll('.view-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `view-${view}`);
  });
  const titleEl = document.getElementById('topbarTitle');
  if (titleEl) titleEl.textContent = VIEW_TITLES[view];

  const sb = document.getElementById('sidebar');
  if (sb) sb.classList.remove('open');

  if (!state.user) return;
  if (view === 'dashboard') renderDashboard();
  if (view === 'inbox') renderInbox();
  if (view === 'library') renderLibrary();
  if (view === 'projects') renderProjects();
  if (view === 'lab') renderLabAssetOptions();
  if (view === 'books') renderBooksView();
  if (view === 'history') loadHistory();
  if (view === 'audit') loadAudit();
  if (view === 'status') loadSystemStatus();
}

function clearBlobCache() {
  for (const url of state.blobCache.values()) {
    URL.revokeObjectURL(url);
  }
  state.blobCache.clear();
}

// --- Core Data Loading ---

async function refreshAll() {
  if (!state.user) return;
  try {
    const [dashboard, projects, assets, books, audit] = await Promise.all([
      api('/api/dashboard'),
      api('/api/projects'),
      api('/api/assets'),
      api('/api/books'),
      api('/api/audit?limit=40'),
    ]);
    state.dashboard = dashboard;
    state.projects = projects || [];
    state.assets = assets || [];
    state.books = books || [];
    state.audit = audit || [];

    if (!state.mappingMeta) {
      state.mappingMeta = await api('/api/mapping/defaults');
      populatePresetSelectors();
      buildLabParamControls();
    }

    updateNavCounts();
    renderDashboard();
    renderInbox();
    syncUploadQueueRowsFromAssets();
    populateLibraryFilters();
    renderLibrary();
    renderProjects();
    renderLabAssetOptions();
    renderBooksView();
    schedulePollingIfActive();
  } catch (err) {
    showToast(err.message || 'Failed to refresh workspace data.', true);
  }
}

function updateNavCounts() {
  const unassignedCount = state.assets.filter((a) => !a.assigned).length;
  const elInbox = document.getElementById('navInboxCount');
  const elLib = document.getElementById('navLibraryCount');
  const elProj = document.getElementById('navProjectsCount');
  const elBooks = document.getElementById('navBooksCount');
  if (elInbox) elInbox.textContent = String(unassignedCount);
  if (elLib) elLib.textContent = String(state.assets.length);
  if (elProj) elProj.textContent = String(state.projects.length);
  if (elBooks) elBooks.textContent = String(state.books.length);
}

function schedulePollingIfActive() {
  const hasActiveJobs =
    state.assets.some((a) => a.status === 'processing' || (a.latest_run && ['queued', 'running'].includes(a.latest_run.state))) ||
    state.books.some((b) => ['queued', 'building'].includes(b.status));

  if (hasActiveJobs && !state.pollTimer) {
    state.pollTimer = setInterval(async () => {
      try {
        await refreshLight();
      } catch {
        // silent background poll
      }
    }, 2500);
  } else if (!hasActiveJobs && state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

async function refreshLight() {
  if (!state.user) return;
  const [dashboard, projects, assets, books] = await Promise.all([
    api('/api/dashboard'),
    api('/api/projects'),
    api('/api/assets'),
    api('/api/books'),
  ]);
  state.dashboard = dashboard;
  state.projects = projects || [];
  state.assets = assets || [];
  state.books = books || [];
  updateNavCounts();

  if (state.currentView === 'dashboard') renderDashboard();
  if (state.currentView === 'inbox') renderInbox();
  syncUploadQueueRowsFromAssets();
  if (state.currentView === 'library') renderLibrary();
  if (state.currentView === 'projects') renderProjects();
  if (state.currentView === 'lab') renderLabResults();
  if (state.currentView === 'books') renderBooksView();
  if (state.currentView === 'history') await loadHistory();

  schedulePollingIfActive();
}

// --- 1. Dashboard ---

function renderDashboard() {
  const d = state.dashboard || {};
  const setTxt = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(val ?? 0);
  };
  setTxt('kpiTotal', d.assets ?? state.assets.length);
  setTxt('kpiInbox', d.unassigned ?? state.assets.filter((a) => !a.assigned).length);
  setTxt('kpiReview', d.needs_review ?? 0);
  setTxt('kpiProjects', d.projects ?? state.projects.length);
  setTxt('kpiBooks', d.books ?? state.books.length);

  const actEl = document.getElementById('dashboardAudit');
  if (!actEl) return;
  if (!state.audit || state.audit.length === 0) {
    actEl.innerHTML = '<div style="color:var(--text-muted)">No workspace events recorded yet. Upload an image in Artwork Inbox to begin.</div>';
    return;
  }
  actEl.innerHTML = state.audit
    .slice(0, 8)
    .map(
      (ev) => `
      <div style="display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--border-hairline)">
        <div>
          <strong style="color:var(--text-primary)">${esc(ev.entity_type)}</strong> · ${esc(ev.action)}
          <div style="font-size:12px;color:var(--text-muted)">${esc(ev.detail || ev.entity_id)}</div>
        </div>
        <div class="mono" style="font-size:11px;color:var(--text-muted);white-space:nowrap">${esc(fmtDate(ev.created_at))}</div>
      </div>`,
    )
    .join('');
}

// --- 2. Artwork Inbox (Independent Upload) ---

function setupDropzone() {
  const dz = document.getElementById('inboxDropzone');
  const fileInput = document.getElementById('inboxFileInput');
  if (!dz || !fileInput) return;

  dz.addEventListener('dragover', (e) => {
    e.preventDefault();
    dz.classList.add('drag-over');
  });
  dz.addEventListener('dragleave', (e) => {
    if (!dz.contains(e.relatedTarget)) {
      dz.classList.remove('drag-over');
    }
  });
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('drag-over');
    if (e.dataTransfer?.files?.length) {
      handleInboxUpload(e.dataTransfer.files);
    }
  });
  fileInput.addEventListener('change', (e) => {
    const files = e.target.files;
    if (files?.length) {
      handleInboxUpload(files);
    }
    e.target.value = '';
  });
}

function validateImageFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!ALLOWED_EXTS.has(ext)) {
    return 'Unsupported file format. Only PNG, JPG, JPEG, and WEBP are allowed.';
  }
  if (file.size > MAX_FILE_BYTES) {
    return 'File exceeds the 25 MB maximum upload size.';
  }
  if (file.size === 0) {
    return 'File is empty.';
  }
  return null;
}

async function uploadSingleFileXHR(url, file, logicalName, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && onProgress) {
        onProgress(Math.round((ev.loaded / ev.total) * 100));
      }
    };
    xhr.onload = () => {
      let body = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body);
      } else {
        reject(new Error(body?.detail || `Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error while uploading image.'));

    const fd = new FormData();
    fd.append('file', file);
    if (logicalName) fd.append('logical_name', logicalName);
    xhr.send(fd);
  });
}

function initUploadOptionsFromStorage() {
  const autoChk = document.getElementById('inboxAutoProcess');
  const presetSel = document.getElementById('inboxPresetSelect');
  const bgChk = document.getElementById('inboxBgRemove');
  const bgMode = document.getElementById('inboxBgMode');

  if (autoChk) {
    const saved = localStorage.getItem(LS_AUTO_PROCESS_KEY);
    autoChk.checked = saved === null ? true : saved === 'true';
  }
  if (presetSel) {
    const savedPreset = localStorage.getItem(LS_UPLOAD_PRESET_KEY);
    if (savedPreset && Array.from(presetSel.options).some((o) => o.value === savedPreset)) {
      presetSel.value = savedPreset;
    }
  }
  if (bgChk && bgMode) {
    bgMode.disabled = !bgChk.checked;
  }
}

function onUploadOptionsChange() {
  const autoChk = document.getElementById('inboxAutoProcess');
  const presetSel = document.getElementById('inboxPresetSelect');
  const bgChk = document.getElementById('inboxBgRemove');
  const bgMode = document.getElementById('inboxBgMode');

  if (autoChk) localStorage.setItem(LS_AUTO_PROCESS_KEY, String(autoChk.checked));
  if (presetSel) localStorage.setItem(LS_UPLOAD_PRESET_KEY, presetSel.value);
  if (bgChk && bgMode) {
    bgMode.disabled = !bgChk.checked;
  }
}

function getUploadProcessOptions() {
  const autoProcess = document.getElementById('inboxAutoProcess')?.checked ?? true;
  const preset = document.getElementById('inboxPresetSelect')?.value || 'auto';
  const bgEnabled = Boolean(document.getElementById('inboxBgRemove')?.checked);
  const bgMode = document.getElementById('inboxBgMode')?.value || 'simple';
  return {
    autoProcess,
    preset,
    bgRemoval: bgEnabled ? bgMode : 'off',
  };
}

function populatePresetSelectors() {
  if (!state.mappingMeta) return;
  const presets = state.mappingMeta.presets || {};
  const autoMeta = state.mappingMeta.auto_preset || {
    label_en: 'Auto (recommended)',
    description_en: 'Automatically selects preset and engine based on image analysis.',
  };

  const inboxSel = document.getElementById('inboxPresetSelect');
  if (inboxSel) {
    const prev = localStorage.getItem(LS_UPLOAD_PRESET_KEY) || inboxSel.value || 'auto';
    inboxSel.innerHTML = [
      `<option value="auto">${esc(autoMeta.label_en)}</option>`,
      ...Object.entries(presets).map(
        ([k, p]) => `<option value="${esc(k)}">${esc(p.label_en)}</option>`,
      ),
    ].join('');
    inboxSel.value = Array.from(inboxSel.options).some((o) => o.value === prev) ? prev : 'auto';
  }

  const labSel = document.getElementById('labPresetSelect');
  if (labSel) {
    const prev = labSel.value || 'auto';
    labSel.innerHTML = [
      `<option value="auto">${esc(autoMeta.label_en)}</option>`,
      ...Object.entries(presets).map(
        ([k, p]) => `<option value="${esc(k)}">${esc(p.label_en)}</option>`,
      ),
      `<option value="">Custom / Manual</option>`,
    ].join('');
    labSel.value = Array.from(labSel.options).some((o) => o.value === prev) ? prev : 'auto';
    updateLabPresetDescription(labSel.value);
  }
}

function setUploadRowStatus(rowId, text, color, barWidth) {
  if (!rowId) return;
  const statusEl = document.getElementById(`${rowId}-status`);
  const barEl = document.getElementById(`${rowId}-bar`);
  if (statusEl) {
    statusEl.textContent = text;
    if (color) statusEl.style.color = color;
  }
  if (barEl) {
    if (barWidth !== undefined) barEl.style.width = `${barWidth}%`;
    if (color) barEl.style.background = color;
  }
}

function syncUploadQueueRowsFromAssets() {
  if (!state.uploadRowMap || state.uploadRowMap.size === 0) return;
  for (const [assetId, info] of state.uploadRowMap.entries()) {
    const asset = state.assets.find((a) => a.id === assetId);
    if (!asset) continue;
    const run = asset.latest_run;
    const dupSuffix = info.duplicate ? ' · Duplicate SHA-256' : '';
    if (!run) {
      if (info.queued) {
        setUploadRowStatus(info.rowId, `Queued${dupSuffix}`, 'var(--status-warning)', 100);
      }
      continue;
    }
    if (run.state === 'queued') {
      setUploadRowStatus(info.rowId, `Queued${dupSuffix}`, 'var(--status-warning)', 100);
    } else if (run.state === 'running') {
      setUploadRowStatus(info.rowId, `Processing${dupSuffix}`, 'var(--status-warning)', 100);
    } else if (run.state === 'completed') {
      setUploadRowStatus(info.rowId, `Ready for review (Engine ${run.engine})${dupSuffix}`, 'var(--status-success)', 100);
    } else if (run.state === 'failed') {
      setUploadRowStatus(info.rowId, run.error || 'Processing failed', 'var(--status-error)', 100);
    }
  }
}

function enqueueAutoProcess(assetId, rowId, isDuplicate, opts) {
  const options = opts || getUploadProcessOptions();
  state.uploadRowMap.set(assetId, {
    rowId: rowId || null,
    duplicate: Boolean(isDuplicate),
    queued: true,
  });
  if (rowId) {
    setUploadRowStatus(
      rowId,
      isDuplicate ? 'Uploaded → Queued · Duplicate SHA-256' : 'Uploaded → Queued',
      'var(--status-warning)',
      100,
    );
  }
  state.uploadProcessQueue.push({
    assetId,
    rowId: rowId || null,
    isDuplicate: Boolean(isDuplicate),
    preset: options.preset,
    bgRemoval: options.bgRemoval,
  });
  drainAutoProcessQueue();
}

function drainAutoProcessQueue() {
  while (
    state.uploadProcessActive < MAX_AUTO_PROCESS_CONCURRENCY &&
    state.uploadProcessQueue.length > 0
  ) {
    const item = state.uploadProcessQueue.shift();
    state.uploadProcessActive++;
    (async () => {
      try {
        await api(`/api/assets/${item.assetId}/process`, {
          method: 'POST',
          body: JSON.stringify({
            preset: item.preset,
            selected_engine: 'auto',
            bg_removal: item.bgRemoval,
          }),
        });
        if (item.rowId) {
          setUploadRowStatus(item.rowId, 'Queued', 'var(--status-warning)', 100);
        }
        await refreshLight();
      } catch (err) {
        if (item.rowId) {
          setUploadRowStatus(item.rowId, err.message || 'Failed to queue processing', 'var(--status-error)', 100);
        }
        showToast(err.message || 'Auto-process failed to start.', true);
      } finally {
        state.uploadProcessActive--;
        drainAutoProcessQueue();
      }
    })();
  }
}

async function handleInboxUpload(fileList) {
  if (!state.user) {
    showToast('The local workspace is still initializing. Please try again.', true);
    return;
  }
  const files = Array.from(fileList);
  const queueEl = document.getElementById('inboxUploadQueue');
  const prefix = (document.getElementById('inboxNamePrefix')?.value || '').trim();
  const procOpts = getUploadProcessOptions();
  if (!queueEl) return;

  queueEl.innerHTML = '';
  state.uploadRowMap.clear();
  let uploadedCount = 0;
  let duplicateCount = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const row = document.createElement('div');
    row.className = 'upload-row';
    const rowId = `up-${Date.now()}-${i}`;
    row.innerHTML = `
      <div class="upload-row-top">
        <span><strong>${esc(file.name)}</strong> (${esc(fmtBytes(file.size))})</span>
        <span class="mono" id="${rowId}-status">Validating...</span>
      </div>
      <div class="progress-track"><div class="progress-fill" id="${rowId}-bar" style="width:0%"></div></div>
    `;
    queueEl.appendChild(row);

    const statusEl = document.getElementById(`${rowId}-status`);
    const barEl = document.getElementById(`${rowId}-bar`);

    const validationErr = validateImageFile(file);
    if (validationErr) {
      statusEl.textContent = validationErr;
      statusEl.style.color = 'var(--status-error)';
      barEl.style.background = 'var(--status-error)';
      barEl.style.width = '100%';
      continue;
    }

    const baseName = file.name.replace(/\.[^.]+$/, '');
    const logicalName = prefix ? `${prefix} - ${baseName}` : baseName;

    try {
      statusEl.textContent = 'Uploading 0%';
      const created = await uploadSingleFileXHR('/api/assets/upload', file, logicalName, (pct) => {
        statusEl.textContent = `Uploading ${pct}%`;
        barEl.style.width = `${pct}%`;
      });
      uploadedCount++;
      if (created?.is_duplicate) {
        duplicateCount++;
        showToast(`Duplicate SHA-256 detected for "${created.logical_name}" — processing anyway.`);
      }
      statusEl.textContent = created?.is_duplicate
        ? `Uploaded (${created.id}) · Duplicate SHA-256`
        : `Uploaded (${created.id})`;
      statusEl.style.color = created?.is_duplicate ? 'var(--status-warning)' : 'var(--status-success)';
      barEl.style.width = '100%';
      barEl.style.background = created?.is_duplicate ? 'var(--status-warning)' : 'var(--status-success)';

      if (procOpts.autoProcess && created?.id) {
        enqueueAutoProcess(created.id, rowId, created.is_duplicate, procOpts);
      }
    } catch (err) {
      statusEl.textContent = err.message || 'Upload failed';
      statusEl.style.color = 'var(--status-error)';
      barEl.style.background = 'var(--status-error)';
      barEl.style.width = '100%';
    }
  }

  if (uploadedCount > 0) {
    const dupNote = duplicateCount > 0 ? ` (${duplicateCount} duplicate fingerprint flagged)` : '';
    const autoNote = procOpts.autoProcess ? ' Auto-processing queued.' : '';
    showToast(`Uploaded ${uploadedCount} artwork${uploadedCount === 1 ? '' : 's'} to Artwork Inbox${dupNote}.${autoNote}`);
    await refreshAll();
  }
}

function getFilteredInboxAssets() {
  const q = (document.getElementById('inboxSearch')?.value || '').trim().toLowerCase();
  const filter = document.getElementById('inboxFilter')?.value || 'unassigned';

  return state.assets.filter((a) => {
    if (filter === 'unassigned' && a.assigned) return false;
    if (filter === 'duplicates' && !a.is_duplicate) return false;
    if (!q) return true;
    return (
      a.logical_name.toLowerCase().includes(q) ||
      a.filename.toLowerCase().includes(q) ||
      a.id.toLowerCase().includes(q) ||
      a.sha256.toLowerCase().includes(q)
    );
  });
}

function updateInboxSelectionUI() {
  const count = state.selectedInboxIds.size;
  const infoEl = document.getElementById('inboxSelectionInfo');
  const assignBtn = document.getElementById('inboxAssignBtn');
  const procBtn = document.getElementById('inboxProcessSelectedBtn');
  const delBtn = document.getElementById('inboxDeleteBtn');
  if (infoEl) infoEl.textContent = `${count} selected`;
  if (assignBtn) assignBtn.disabled = count === 0;
  if (procBtn) procBtn.disabled = count === 0;
  if (delBtn) delBtn.disabled = count === 0;
}

function toggleInboxSelect(assetId, checked) {
  if (checked) state.selectedInboxIds.add(assetId);
  else state.selectedInboxIds.delete(assetId);
  updateInboxSelectionUI();
  const card = document.querySelector(`[data-inbox-card="${assetId}"]`);
  if (card) card.classList.toggle('selected', checked);
}

function selectAllInbox(flag) {
  const list = getFilteredInboxAssets();
  if (flag) {
    list.forEach((a) => state.selectedInboxIds.add(a.id));
  } else {
    state.selectedInboxIds.clear();
  }
  renderInbox();
}

function toggleLibrarySelect(assetId, checked) {
  if (checked) state.selectedLibraryIds.add(assetId);
  else state.selectedLibraryIds.delete(assetId);
  updateLibrarySelectionUI();
  const card = document.querySelector(`[data-library-card="${assetId}"]`);
  if (card) card.classList.toggle('selected', checked);
}

function updateLibrarySelectionUI() {
  const count = state.selectedLibraryIds.size;
  const infoEl = document.getElementById('librarySelectionInfo');
  const assignBtn = document.getElementById('libraryAssignBtn');
  const delBtn = document.getElementById('libraryDeleteBtn');
  if (infoEl) infoEl.textContent = `${count} selected`;
  if (assignBtn) assignBtn.disabled = count === 0;
  if (delBtn) delBtn.disabled = count === 0;
}

function selectAllLibrary(flag) {
  const list = getFilteredLibraryAssets();
  if (flag) {
    list.forEach((a) => state.selectedLibraryIds.add(a.id));
  } else {
    state.selectedLibraryIds.clear();
  }
  renderLibrary();
}

function toggleProjectAssetSelect(assetId, checked) {
  if (checked) state.selectedProjectAssetIds.add(assetId);
  else state.selectedProjectAssetIds.delete(assetId);
  updateProjectSelectionUI();
  const card = document.querySelector(`[data-project-card="${assetId}"]`);
  if (card) card.classList.toggle('selected', checked);
}

function updateProjectSelectionUI() {
  const count = state.selectedProjectAssetIds.size;
  const infoEl = document.getElementById('projectSelectionInfo');
  const remBtn = document.getElementById('projectRemoveSelectedBtn');
  const delBtn = document.getElementById('projectDeleteSelectedBtn');
  if (infoEl) infoEl.textContent = `${count} selected`;
  if (remBtn) remBtn.disabled = count === 0;
  if (delBtn) delBtn.disabled = count === 0;
}

function selectAllProjectAssets(flag) {
  const projectAssets = state.assets.filter((a) => a.project_id === state.selectedProjectId);
  if (flag) {
    projectAssets.forEach((a) => state.selectedProjectAssetIds.add(a.id));
  } else {
    state.selectedProjectAssetIds.clear();
  }
  renderProjects();
}

function renderAssetCardHtml(a, context) {
  const isSelected =
    (context === 'inbox' && state.selectedInboxIds.has(a.id)) ||
    (context === 'library' && state.selectedLibraryIds.has(a.id)) ||
    (context === 'project' && state.selectedProjectAssetIds.has(a.id));
  const checkHandler =
    context === 'inbox'
      ? `toggleInboxSelect('${esc(a.id)}', this.checked)`
      : context === 'library'
        ? `toggleLibrarySelect('${esc(a.id)}', this.checked)`
        : context === 'project'
          ? `toggleProjectAssetSelect('${esc(a.id)}', this.checked)`
          : '';
  const dataAttr =
    context === 'inbox'
      ? `data-inbox-card="${esc(a.id)}"`
      : context === 'library'
        ? `data-library-card="${esc(a.id)}"`
        : context === 'project'
          ? `data-project-card="${esc(a.id)}"`
          : '';

  const imgUrl = a.preview_url || a.source_url;
  const dims = a.width && a.height ? `${a.width}×${a.height}` : 'Unknown dims';
  const locText = a.assigned ? `Project: ${a.project_name || a.project_id}` : 'Unassigned (Inbox)';
  const dupHtml = a.is_duplicate
    ? '<span style="color:var(--status-warning);font-weight:600">Duplicate SHA-256</span>'
    : '';

  const removeFromProjBtn = a.assigned && a.project_id
    ? `<button class="btn-secondary btn-sm" onclick="confirmRemoveFromProject('${esc(a.project_id)}', ['${esc(a.id)}'], '${esc(a.logical_name)}')">Remove from Project</button>`
    : '';
  const deleteBtnLabel = context === 'project' ? 'Delete Permanently' : 'Delete';

  return `
    <article class="asset-card ${isSelected ? 'selected' : ''}" ${dataAttr}>
      <div class="asset-thumb-wrap">
        ${
          checkHandler
            ? `<input type="checkbox" class="asset-check" aria-label="Select ${esc(a.logical_name)}" ${isSelected ? 'checked' : ''} onchange="${checkHandler}">`
            : ''
        }
        <img data-image-src="${esc(imgUrl)}" alt="${esc(a.logical_name)}">
      </div>
      <div class="asset-body">
        <div class="asset-title" title="${esc(a.logical_name)}">${esc(a.logical_name)}</div>
        <div class="meta-line">
          <span class="status-text status-${esc(a.status)}">${esc(statusLabel(a.status))}</span>
          <span>·</span>
          <span>${esc(locText)}</span>
        </div>
        <div class="meta-line tabular">
          <span>${esc(dims)}</span>
          <span>·</span>
          <span>${esc(fmtBytes(a.file_size))}</span>
          <span>·</span>
          <span>v${esc(a.version)}</span>
        </div>
        <div class="meta-line" title="${esc(a.filename)}">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px">${esc(a.filename)}</span>
        </div>
        <div class="meta-line mono" style="font-size:11px">
          <span>ID: ${esc(a.id)}</span>
          <span>·</span>
          <span>SHA: ${esc(a.sha256.slice(0, 10))}…</span>
        </div>
        <div class="meta-line" style="font-size:11px;color:var(--text-muted)">
          <span>Uploaded ${esc(fmtDate(a.created_at))}</span>
          ${dupHtml ? `<span>·</span>${dupHtml}` : ''}
        </div>
        <div class="asset-actions">
          <button class="btn-secondary btn-sm" onclick="openInLab('${esc(a.id)}')">Process / Inspect</button>
          <button class="btn-secondary btn-sm" onclick="openAssignModal(['${esc(a.id)}'])">${a.assigned ? 'Move Project' : 'Assign'}</button>
          ${removeFromProjBtn}
          ${
            a.status === 'review'
              ? `<button class="btn-primary btn-sm" onclick="openReviewModal('${esc(a.id)}', 'approve')">Approve</button>`
              : ''
          }
          <button class="btn-secondary btn-sm" onclick="triggerRevisionUpload('${esc(a.id)}')">Revision</button>
          <button class="btn-danger btn-sm" onclick="confirmDeleteAssets(['${esc(a.id)}'], '${esc(a.logical_name)}')">${deleteBtnLabel}</button>
        </div>
      </div>
    </article>
  `;
}

function renderInbox() {
  const grid = document.getElementById('inboxGrid');
  if (!grid) return;

  // Prune selections that no longer exist
  const existingIds = new Set(state.assets.map((a) => a.id));
  for (const id of state.selectedInboxIds) {
    if (!existingIds.has(id)) state.selectedInboxIds.delete(id);
  }
  updateInboxSelectionUI();

  const list = getFilteredInboxAssets();
  if (list.length === 0) {
    const filter = document.getElementById('inboxFilter')?.value || 'unassigned';
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <h3>${filter === 'unassigned' ? 'Artwork Inbox is empty' : 'No matching artworks found'}</h3>
        <p>${
          filter === 'unassigned'
            ? 'Drop PNG, JPG, JPEG, or WEBP images in the upload area above. No project is needed to start.'
            : 'Try clearing your search query or changing the filter.'
        }</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = list.map((a) => renderAssetCardHtml(a, 'inbox')).join('');
  hydrateImages(grid);
}

async function processSelectedInbox() {
  const ids = Array.from(state.selectedInboxIds);
  if (ids.length === 0) return;

  const opts = getUploadProcessOptions();
  const candidates = ids
    .map((id) => state.assets.find((a) => a.id === id))
    .filter((asset) => asset && asset.status !== 'processing');

  if (candidates.length === 0) return;

  for (const asset of candidates) {
    enqueueAutoProcess(asset.id, null, asset.is_duplicate, opts);
  }
  showToast(`Queued ${candidates.length} artwork${candidates.length === 1 ? '' : 's'} for processing (${opts.preset}).`);
}

// --- Revision Upload ---

function triggerRevisionUpload(assetId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const errMsg = validateImageFile(file);
    if (errMsg) {
      showToast(errMsg, true);
      return;
    }
    try {
      const created = await uploadSingleFileXHR(`/api/assets/${assetId}/revisions`, file, '');
      const procOpts = getUploadProcessOptions();
      if (created?.is_duplicate) {
        showToast(`Duplicate SHA-256 detected for revision v${created.version} — continuing.`);
      }
      if (procOpts.autoProcess && created?.id) {
        enqueueAutoProcess(created.id, null, created.is_duplicate, procOpts);
        showToast(`Uploaded revision v${created.version} (${created.id}) and queued auto-processing.`);
      } else {
        showToast(`Uploaded revision v${created.version} (${created.id}).`);
      }
      await refreshAll();
    } catch (err) {
      showToast(err.message || 'Revision upload failed.', true);
    }
  };
  input.click();
}

// --- 3. Artwork Library ---

function populateLibraryFilters() {
  const projSel = document.getElementById('libraryProjectFilter');
  if (!projSel) return;
  const current = projSel.value;
  projSel.innerHTML = `
    <option value="">All Locations</option>
    <option value="__unassigned__">Unassigned (Artwork Inbox)</option>
    ${state.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}
  `;
  if (Array.from(projSel.options).some((o) => o.value === current)) {
    projSel.value = current;
  }
}

function getFilteredLibraryAssets() {
  const q = (document.getElementById('librarySearch')?.value || '').trim().toLowerCase();
  const projFilter = document.getElementById('libraryProjectFilter')?.value || '';
  const statusFilter = document.getElementById('libraryStatusFilter')?.value || '';

  return state.assets.filter((a) => {
    if (projFilter === '__unassigned__' && a.assigned) return false;
    if (projFilter && projFilter !== '__unassigned__' && a.project_id !== projFilter) return false;
    if (statusFilter && a.status !== statusFilter) return false;
    if (!q) return true;
    return (
      a.logical_name.toLowerCase().includes(q) ||
      a.filename.toLowerCase().includes(q) ||
      a.id.toLowerCase().includes(q) ||
      (a.project_name || '').toLowerCase().includes(q)
    );
  });
}

function renderLibrary() {
  const grid = document.getElementById('libraryGrid');
  if (!grid) return;

  const existingIds = new Set(state.assets.map((a) => a.id));
  for (const id of state.selectedLibraryIds) {
    if (!existingIds.has(id)) state.selectedLibraryIds.delete(id);
  }
  updateLibrarySelectionUI();

  const list = getFilteredLibraryAssets();

  if (list.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <h3>No artworks match these filters</h3>
        <p>Upload images to Artwork Inbox or adjust your search and filter criteria.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = list.map((a) => renderAssetCardHtml(a, 'library')).join('');
  hydrateImages(grid);
}

// --- Assign to Project Modal ---

function openAssignModal(explicitIds) {
  const ids = Array.isArray(explicitIds) && explicitIds.length > 0
    ? explicitIds
    : Array.from(state.selectedInboxIds);

  if (ids.length === 0) {
    showToast('Select at least one artwork first.', true);
    return;
  }

  state.assignTargetIds = ids;
  const summary = document.getElementById('assignSummaryText');
  if (summary) {
    summary.textContent = `${ids.length} artwork${ids.length === 1 ? '' : 's'} selected. Assigning updates project membership without duplicating files or changing asset IDs.`;
  }

  const sel = document.getElementById('assignProjectSelect');
  if (sel) {
    if (state.projects.length === 0) {
      sel.innerHTML = '<option value="">No existing projects — switch to Create New Project</option>';
      switchAssignTab('new');
    } else {
      sel.innerHTML = state.projects
        .map((p) => `<option value="${esc(p.id)}">${esc(p.name)} (${p.asset_count} artworks)</option>`)
        .join('');
      switchAssignTab('existing');
    }
  }
  document.getElementById('assignModal')?.classList.add('open');
}

function switchAssignTab(tab) {
  state.assignTab = tab;
  document.getElementById('tabExistingProj')?.classList.toggle('active', tab === 'existing');
  document.getElementById('tabNewProj')?.classList.toggle('active', tab === 'new');
  const existingPane = document.getElementById('assignExistingPane');
  const newPane = document.getElementById('assignNewPane');
  if (existingPane) existingPane.style.display = tab === 'existing' ? 'block' : 'none';
  if (newPane) newPane.style.display = tab === 'new' ? 'block' : 'none';
}

async function confirmAssignToProject() {
  if (!state.assignTargetIds.length) return;

  try {
    let projectId = '';
    if (state.assignTab === 'new') {
      const name = (document.getElementById('assignNewProjectName')?.value || '').trim();
      const description = (document.getElementById('assignNewProjectDesc')?.value || '').trim();
      if (!name) {
        showToast('Enter a project name.', true);
        return;
      }
      const createdProj = await api('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ name, description }),
      });
      projectId = createdProj.id;
      document.getElementById('assignNewProjectName').value = '';
      document.getElementById('assignNewProjectDesc').value = '';
    } else {
      projectId = document.getElementById('assignProjectSelect')?.value || '';
      if (!projectId) {
        showToast('Select an existing project or create a new one.', true);
        return;
      }
    }

    const res = await api(`/api/projects/${projectId}/assign-assets`, {
      method: 'POST',
      body: JSON.stringify({ asset_ids: state.assignTargetIds }),
    });

    state.assignTargetIds.forEach((id) => state.selectedInboxIds.delete(id));
    closeModal('assignModal');
    showToast(`Assigned ${res.assigned_count} artwork${res.assigned_count === 1 ? '' : 's'} to ${res.project_name}.`);
    await refreshAll();
  } catch (err) {
    showToast(err.message || 'Failed to assign artworks.', true);
  }
}

// --- 4. Projects ---

function openCreateProjectModal() {
  document.getElementById('newProjectName').value = '';
  document.getElementById('newProjectDesc').value = '';
  document.getElementById('createProjectModal')?.classList.add('open');
}

async function submitCreateProject() {
  const name = (document.getElementById('newProjectName')?.value || '').trim();
  const description = (document.getElementById('newProjectDesc')?.value || '').trim();
  if (!name) {
    showToast('Project name is required.', true);
    return;
  }
  try {
    const created = await api('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    });
    closeModal('createProjectModal');
    state.selectedProjectId = created.id;
    showToast(`Created project "${created.name}".`);
    await refreshAll();
  } catch (err) {
    showToast(err.message || 'Failed to create project.', true);
  }
}

function selectProjectDetail(projectId) {
  state.selectedProjectId = projectId;
  renderProjects();
}

function triggerProjectDirectUpload(projectId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp';
  input.multiple = true;
  input.onchange = async () => {
    const files = Array.from(input.files || []);
    if (!files.length) return;
    const procOpts = getUploadProcessOptions();
    let ok = 0;
    for (const file of files) {
      const errMsg = validateImageFile(file);
      if (errMsg) {
        showToast(`${file.name}: ${errMsg}`, true);
        continue;
      }
      try {
        const created = await uploadSingleFileXHR(`/api/projects/${projectId}/assets`, file, file.name.replace(/\.[^.]+$/, ''));
        ok++;
        if (created?.is_duplicate) {
          showToast(`Duplicate SHA-256 detected for "${created.logical_name}" — processing anyway.`);
        }
        if (procOpts.autoProcess && created?.id) {
          enqueueAutoProcess(created.id, null, created.is_duplicate, procOpts);
        }
      } catch (err) {
        showToast(`${file.name}: ${err.message}`, true);
      }
    }
    if (ok > 0) {
      const autoNote = procOpts.autoProcess ? ' Auto-processing queued.' : '';
      showToast(`Uploaded ${ok} artwork${ok === 1 ? '' : 's'} directly to project.${autoNote}`);
      await refreshAll();
    }
  };
  input.click();
}

function renderProjects() {
  const wrap = document.getElementById('projectsContainer');
  const detailEl = document.getElementById('projectDetailPanel');
  if (!wrap || !detailEl) return;

  if (state.projects.length === 0) {
    wrap.innerHTML = `
      <div class="empty-state" style="border:none">
        <h3>No projects yet</h3>
        <p>You can upload images to Artwork Inbox first, then create a project here when you are ready to assemble a book.</p>
        <button class="btn-primary" onclick="openCreateProjectModal()">Create Project</button>
      </div>
    `;
    detailEl.style.display = 'none';
    return;
  }

  wrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Project Name</th>
          <th>Description</th>
          <th class="num">Artworks</th>
          <th class="num">Approved</th>
          <th>Status</th>
          <th>Created</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${state.projects
          .map(
            (p) => `
          <tr>
            <td><strong>${esc(p.name)}</strong><div class="mono" style="font-size:11px;color:var(--text-muted)">${esc(p.id)}</div></td>
            <td>${esc(p.description || '—')}</td>
            <td class="num">${esc(p.asset_count)}</td>
            <td class="num">${esc(p.approved_count)}</td>
            <td><span class="status-text status-${p.approved_count > 0 ? 'approved' : 'uploaded'}">${esc(statusLabel(p.status))}</span></td>
            <td class="tabular">${esc(fmtDate(p.created_at))}</td>
            <td>
              <div style="display:flex;gap:6px">
                <button class="btn-secondary btn-sm" onclick="selectProjectDetail('${esc(p.id)}')">Inspect</button>
                <button class="btn-secondary btn-sm" onclick="goToProjectBooks('${esc(p.id)}')">Books</button>
              </div>
            </td>
          </tr>
        `,
          )
          .join('')}
      </tbody>
    </table>
  `;

  const selected = state.projects.find((p) => p.id === state.selectedProjectId) || state.projects[0];
  if (!selected) {
    detailEl.style.display = 'none';
    return;
  }
  state.selectedProjectId = selected.id;
  const projectAssets = state.assets.filter((a) => a.project_id === selected.id);
  const projectAssetIds = new Set(projectAssets.map((a) => a.id));
  for (const id of state.selectedProjectAssetIds) {
    if (!projectAssetIds.has(id)) state.selectedProjectAssetIds.delete(id);
  }

  detailEl.style.display = 'block';
  detailEl.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:14px">
      <div>
        <h3>${esc(selected.name)}</h3>
        <p class="page-subtitle">${esc(selected.description || 'No description')} · ID: <span class="mono">${esc(selected.id)}</span></p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn-secondary btn-sm" onclick="navigate('inbox')">Assign from Inbox</button>
        <button class="btn-secondary btn-sm" onclick="triggerProjectDirectUpload('${esc(selected.id)}')">Upload to Project</button>
        <button class="btn-primary btn-sm" onclick="goToProjectBooks('${esc(selected.id)}')">Open Book Builder</button>
      </div>
    </div>
    ${
      projectAssets.length === 0
        ? '<div class="empty-state"><h3>No artworks assigned to this project yet</h3><p>Select images in Artwork Inbox and click Assign to Project, or upload directly to this project.</p></div>'
        : `
          <div class="toolbar" style="margin-bottom:14px">
            <div class="toolbar-group">
              <span class="meta-line tabular" id="projectSelectionInfo">${state.selectedProjectAssetIds.size} selected</span>
              <button class="btn-secondary btn-sm" onclick="selectAllProjectAssets(true)">Select All</button>
              <button class="btn-secondary btn-sm" onclick="selectAllProjectAssets(false)">Clear</button>
            </div>
            <div class="toolbar-group">
              <button class="btn-secondary btn-sm" id="projectRemoveSelectedBtn" onclick="confirmRemoveSelectedFromProject('${esc(selected.id)}')" ${state.selectedProjectAssetIds.size === 0 ? 'disabled' : ''}>Remove Selected from Project</button>
              <button class="btn-danger btn-sm" id="projectDeleteSelectedBtn" onclick="confirmDeleteSelectedProject()" ${state.selectedProjectAssetIds.size === 0 ? 'disabled' : ''}>Delete Selected Permanently</button>
            </div>
          </div>
          <div class="asset-grid">${projectAssets.map((a) => renderAssetCardHtml(a, 'project')).join('')}</div>
        `
    }
  `;
  hydrateImages(detailEl);
}

function goToProjectBooks(projectId) {
  navigate('books');
  const sel = document.getElementById('bookProjectSelect');
  if (sel) {
    sel.value = projectId;
    renderBookAssetPicker();
  }
}

// --- 5. Processing Lab (29 Notebook v2 Params + Engines A-D) ---

function markLabKeyTouched(key) {
  window.labDirty = true;
  state.labDirty = true;
  if (key) state.labTouchedKeys.add(key);
}

function buildLabParamControls() {
  const container = document.getElementById('labParamsContainer');
  if (!container || !state.mappingMeta) return;

  const { controls, defaults } = state.mappingMeta;
  const groups = ['Preprocess', 'Edges', 'Mapping', 'Background'];
  const bgLabels = {
    off: 'Off (original image)',
    simple: 'Simple (border flood-fill)',
    ai: 'AI (Gemini segmentation)',
  };
  let html = '';

  for (const group of groups) {
    const items = controls.filter((c) => c.group === group);
    if (!items.length) continue;
    html += `<div class="param-group"><h4>${esc(group)}</h4>`;
    for (const c of items) {
      const val = defaults[c.key];
      if (c.kind === 'bool') {
        html += `
          <div class="param-row">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" id="param_${esc(c.key)}" ${val ? 'checked' : ''} onchange="markLabKeyTouched('${esc(c.key)}')" style="width:auto">
              <span>${esc(c.label)}</span>
            </label>
          </div>
        `;
      } else if (c.kind === 'select') {
        const opts = c.key === 'bg_mode' ? ['off', 'simple', 'ai'] : ['none', 'bilateral', 'nlm', 'median'];
        html += `
          <div class="param-row">
            <label for="param_${esc(c.key)}"><span>${esc(c.label)}</span></label>
            <select id="param_${esc(c.key)}" onchange="markLabKeyTouched('${esc(c.key)}')">
              ${opts.map((o) => `<option value="${o}" ${val === o ? 'selected' : ''}>${esc(c.key === 'bg_mode' ? (bgLabels[o] || o) : o)}</option>`).join('')}
            </select>
          </div>
        `;
      } else {
        html += `
          <div class="param-row">
            <label for="param_${esc(c.key)}"><span>${esc(c.label)}</span></label>
            <div class="param-inputs">
              <input type="range" id="range_${esc(c.key)}" min="${c.min}" max="${c.max}" step="${c.step}" value="${val}"
                     oninput="syncParamPair('${esc(c.key)}', this.value, 'num')">
              <input type="number" id="param_${esc(c.key)}" min="${c.min}" max="${c.max}" step="${c.step}" value="${val}"
                     oninput="syncParamPair('${esc(c.key)}', this.value, 'range')">
            </div>
          </div>
        `;
      }
    }
    html += '</div>';
  }
  container.innerHTML = html;
}

function syncParamPair(key, val, targetKind) {
  markLabKeyTouched(key);
  if (targetKind === 'num') {
    const el = document.getElementById(`param_${key}`);
    if (el) el.value = val;
  } else {
    const el = document.getElementById(`range_${key}`);
    if (el) el.value = val;
  }
}

function collectLabParams() {
  if (!state.mappingMeta) return {};
  const out = {};
  for (const c of state.mappingMeta.controls) {
    const el = document.getElementById(`param_${c.key}`);
    if (!el) continue;
    if (c.kind === 'bool') {
      out[c.key] = Boolean(el.checked);
    } else if (c.kind === 'select') {
      out[c.key] = el.value;
    } else {
      const n = Number(el.value);
      if (Number.isFinite(n)) out[c.key] = n;
    }
  }
  return out;
}

function updateLabPresetDescription(presetKey) {
  const descEl = document.getElementById('labPresetDesc');
  if (!descEl || !state.mappingMeta) return;
  if (presetKey === 'auto') {
    descEl.textContent = state.mappingMeta.auto_preset?.description_en || '';
  } else if (presetKey && state.mappingMeta.presets?.[presetKey]) {
    descEl.textContent = state.mappingMeta.presets[presetKey].description_en || '';
  } else {
    descEl.textContent = 'Manual parameter configuration.';
  }
}

function getEffectivePresetParamsForCurrentAsset(presetKey) {
  if (!state.mappingMeta) return {};
  const defaults = state.mappingMeta.defaults || {};
  const preset = state.mappingMeta.presets?.[presetKey];
  if (!preset) return { ...defaults };

  const merged = { ...defaults, ...(preset.params || {}) };
  const asset = state.assets.find((a) => a.id === state.selectedLabAssetId);
  const sideMax = asset?.side_by_side_max_cols ?? 29;
  const fullMax = asset?.full_page_max_cols ?? 50;

  if (presetKey === 'detailed') {
    merged.grid_cols = fullMax;
  } else if (presetKey === 'simple_kids') {
    merged.grid_cols = Math.min(sideMax, 24);
  } else if (presetKey !== 'balanced') {
    merged.grid_cols = Math.min(Number(merged.grid_cols ?? defaults.grid_cols), sideMax);
  }
  return merged;
}

function applyLabParams(params, engine, runStability, presetKey) {
  if (!state.mappingMeta) return;
  const merged = { ...state.mappingMeta.defaults, ...(params || {}) };
  for (const c of state.mappingMeta.controls) {
    const el = document.getElementById(`param_${c.key}`);
    const rangeEl = document.getElementById(`range_${c.key}`);
    const v = merged[c.key];
    if (!el || v === undefined) continue;
    if (c.kind === 'bool') el.checked = Boolean(v);
    else if (c.kind === 'select') el.value = String(v);
    else {
      el.value = String(v);
      if (rangeEl) rangeEl.value = String(v);
    }
  }
  const engEl = document.getElementById('labEngineSelect');
  if (engEl && engine) engEl.value = engine;
  const stabEl = document.getElementById('labRunStability');
  if (stabEl && runStability !== undefined) stabEl.checked = Boolean(runStability);
  const presetEl = document.getElementById('labPresetSelect');
  if (presetEl && presetKey !== undefined) {
    presetEl.value = presetKey || '';
    updateLabPresetDescription(presetEl.value);
  }
}

function onLabPresetChange() {
  const presetSel = document.getElementById('labPresetSelect');
  const presetKey = presetSel ? presetSel.value : '';
  updateLabPresetDescription(presetKey);
  state.labTouchedKeys.clear();
  window.labDirty = true;
  state.labDirty = true;

  if (!state.mappingMeta) return;
  if (presetKey === 'auto') {
    const bgModeEl = document.getElementById('param_bg_mode');
    const keepBg = bgModeEl ? bgModeEl.value : 'off';
    applyLabParams({ ...state.mappingMeta.defaults, bg_mode: keepBg }, 'auto', undefined, 'auto');
    if (keepBg !== 'off') state.labTouchedKeys.add('bg_mode');
    return;
  }
  if (presetKey && state.mappingMeta.presets?.[presetKey]) {
    const preset = state.mappingMeta.presets[presetKey];
    const effective = getEffectivePresetParamsForCurrentAsset(presetKey);
    const engineChoice = presetKey === 'portrait' ? 'auto' : preset.engine;
    applyLabParams(effective, engineChoice, undefined, presetKey);
  }
}

function onLabEngineSelectChange() {
  window.labDirty = true;
  state.labDirty = true;
}

function resetLabToPreset() {
  const presetSel = document.getElementById('labPresetSelect');
  const presetKey = presetSel ? presetSel.value : '';
  if (!presetKey) {
    resetLabDefaults();
    return;
  }
  onLabPresetChange();
  showToast(`Reset sliders to "${presetSel.options[presetSel.selectedIndex]?.text || presetKey}" preset.`);
}

function resetLabDefaults() {
  if (!state.mappingMeta) return;
  state.labTouchedKeys.clear();
  applyLabParams(state.mappingMeta.defaults, 'D', false, 'balanced');
  window.labDirty = false;
  state.labDirty = false;
  showToast('Reset all parameters to Notebook v2 defaults.');
}

function exportLabConfig() {
  const payload = {
    schema: 'chromabook-advanced-mapping-v2',
    preset: document.getElementById('labPresetSelect')?.value || null,
    selected_engine: document.getElementById('labEngineSelect')?.value || 'D',
    run_stability: Boolean(document.getElementById('labRunStability')?.checked),
    params: collectLabParams(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'chromabook_mapping_config.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function openInLab(assetId) {
  state.selectedLabAssetId = assetId;
  state.labTouchedKeys.clear();
  window.labDirty = false;
  state.labDirty = false;
  navigate('lab');
  const sel = document.getElementById('labAssetSelect');
  if (sel) sel.value = assetId;
  onLabAssetChange();
}

function renderLabAssetOptions() {
  const sel = document.getElementById('labAssetSelect');
  if (!sel) return;
  const prev = state.selectedLabAssetId || sel.value;

  if (state.assets.length === 0) {
    sel.innerHTML = '<option value="">No artworks uploaded yet</option>';
    state.selectedLabAssetId = '';
    renderLabResults();
    return;
  }

  sel.innerHTML = state.assets
    .map((a) => {
      const loc = a.assigned ? a.project_name || 'Project' : 'Inbox';
      return `<option value="${esc(a.id)}">${esc(a.logical_name)} (v${a.version}) [${esc(loc)} — ${esc(statusLabel(a.status))}]</option>`;
    })
    .join('');

  if (prev && state.assets.some((a) => a.id === prev)) {
    sel.value = prev;
    state.selectedLabAssetId = prev;
  } else {
    state.selectedLabAssetId = state.assets[0].id;
    sel.value = state.selectedLabAssetId;
  }
  onLabAssetChange();
}

function onLabAssetChange() {
  const sel = document.getElementById('labAssetSelect');
  state.selectedLabAssetId = sel?.value || '';
  const asset = state.assets.find((a) => a.id === state.selectedLabAssetId);
  if (asset?.latest_run?.params && !window.labDirty) {
    const cfg = asset.latest_run.params;
    const presetVal = typeof cfg.preset === 'string' ? cfg.preset : '';
    state.labTouchedKeys.clear();
    applyLabParams(cfg.params || {}, cfg.selected_engine || asset.latest_run.engine || 'D', cfg.run_stability, presetVal);
  }
  renderLabResults();
}

async function runLabProcessing(overrideParams) {
  const assetId = document.getElementById('labAssetSelect')?.value;
  if (!assetId) {
    showToast('Upload or select an artwork first.', true);
    return;
  }
  const preset = document.getElementById('labPresetSelect')?.value || '';
  const selectedEngine = document.getElementById('labEngineSelect')?.value || 'D';
  const runStability = Boolean(document.getElementById('labRunStability')?.checked);
  const allParams = collectLabParams();

  let paramsPayload;
  if (overrideParams && typeof overrideParams === 'object') {
    paramsPayload = overrideParams;
  } else if (!preset) {
    paramsPayload = allParams;
  } else {
    // Only send parameters explicitly modified by the user so presets & auto can enforce 3mm limits & image-adaptive tuning
    paramsPayload = {};
    for (const key of state.labTouchedKeys) {
      if (Object.prototype.hasOwnProperty.call(allParams, key)) {
        paramsPayload[key] = allParams[key];
      }
    }
  }

  const bodyPayload = {
    selected_engine: selectedEngine,
    run_stability: runStability,
    params: paramsPayload,
  };
  if (preset) {
    bodyPayload.preset = preset;
    if (allParams.bg_mode && allParams.bg_mode !== 'off' && !paramsPayload.bg_mode) {
      bodyPayload.bg_removal = allParams.bg_mode;
    }
  }

  try {
    const res = await api(`/api/assets/${assetId}/process`, {
      method: 'POST',
      body: JSON.stringify(bodyPayload),
    });
    window.labDirty = false;
    state.labDirty = false;
    state.labTouchedKeys.clear();
    const warnMsg = Array.isArray(res?.warnings) && res.warnings.length > 0 ? ` (${res.warnings[0]})` : '';
    showToast(`Processing queued (${selectedEngine === 'auto' ? 'Auto engine' : `Engine ${selectedEngine}`})${warnMsg}`);
    await refreshAll();
  } catch (err) {
    showToast(err.message || 'Failed to queue processing.', true);
  }
}

function quickSwitchBgMode(mode) {
  const el = document.getElementById('param_bg_mode');
  if (el) el.value = mode;
  markLabKeyTouched('bg_mode');
  void runLabProcessing({ bg_mode: mode });
}

function selectEngineCard(engineKey) {
  const sel = document.getElementById('labEngineSelect');
  if (sel) sel.value = engineKey;
  window.labDirty = true;
  state.labDirty = true;
  renderLabResults();
}

function renderLabResults() {
  const panel = document.getElementById('labResultsPanel');
  if (!panel) return;
  const asset = state.assets.find((a) => a.id === state.selectedLabAssetId);
  if (!asset) {
    panel.innerHTML = `
      <div class="empty-state">
        <h3>Select an artwork to inspect or process</h3>
        <p>Both unassigned Inbox artworks and project-assigned artworks can be processed here.</p>
      </div>
    `;
    return;
  }

  const run = asset.latest_run;
  const locText = asset.assigned ? `Project: ${asset.project_name || asset.project_id}` : 'Unassigned (Artwork Inbox)';
  const dims = asset.width && asset.height ? `${asset.width}×${asset.height}` : 'Unknown dims';

  let headerHtml = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:16px">
      <div>
        <h3>${esc(asset.logical_name)} <span class="mono" style="font-size:12px;color:var(--text-muted)">v${esc(asset.version)}</span></h3>
        <div class="meta-line" style="margin-top:4px">
          <span class="status-text status-${esc(asset.status)}">${esc(statusLabel(asset.status))}</span>
          <span>·</span>
          <span>${esc(locText)}</span>
          <span>·</span>
          <span class="tabular">${esc(dims)}</span>
          <span>·</span>
          <span class="mono">${esc(asset.id)}</span>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn-secondary btn-sm" onclick="openAssignModal(['${esc(asset.id)}'])">${asset.assigned ? 'Move Project' : 'Assign to Project'}</button>
        ${
          asset.assigned && asset.project_id
            ? `<button class="btn-secondary btn-sm" onclick="confirmRemoveFromProject('${esc(asset.project_id)}', ['${esc(asset.id)}'], '${esc(asset.logical_name)}')">Remove from Project</button>`
            : ''
        }
        ${
          run && run.state === 'completed'
            ? `<button class="btn-primary btn-sm" onclick="openReviewModal('${esc(asset.id)}', 'approve')">Approve Output</button>
               <button class="btn-danger btn-sm" onclick="openReviewModal('${esc(asset.id)}', 'reject')">Reject Output</button>`
            : ''
        }
        <button class="btn-danger btn-sm" onclick="confirmDeleteAssets(['${esc(asset.id)}'], '${esc(asset.logical_name)}')">Delete Artwork</button>
      </div>
    </div>
  `;

  if (!run) {
    panel.innerHTML = `${headerHtml}
      <div class="split-2">
        <div class="surface" style="padding:12px">
          <h4 style="margin-bottom:8px">Original Artwork</h4>
          <img data-image-src="${esc(asset.source_url)}" alt="${esc(asset.logical_name)}" style="width:100%;max-height:360px;object-fit:contain;background:var(--bg-subtle);border-radius:6px">
        </div>
        <div class="empty-state">
          <h3>Ready to process</h3>
          <p>Adjust any of the 29 Notebook v2 parameters on the left and click Run Processing to compare Engines A, B, C, and D.</p>
        </div>
      </div>
    `;
    hydrateImages(panel);
    return;
  }

  if (run.state === 'queued' || run.state === 'running') {
    panel.innerHTML = `${headerHtml}
      <div class="empty-state">
        <h3>Processing in progress (${esc(statusLabel(run.state))})</h3>
        <p>Evaluating Engines A, B, C, and D against the locked 21-color palette. Results will appear automatically.</p>
      </div>
    `;
    return;
  }

  if (run.state === 'failed') {
    panel.innerHTML = `${headerHtml}
      <div class="empty-state" style="border-color:#fecaca">
        <h3 style="color:var(--status-error)">Processing failed</h3>
        <p>${esc(run.error || 'An error occurred during processing.')}</p>
      </div>
    `;
    return;
  }

  const basePreview = run.preview_base_url;
  const metricsObj = run.metrics?.engines || {};
  const chosenEngine = document.getElementById('labEngineSelect')?.value || run.engine || 'D';
  const engineKeys = ['A', 'B', 'C', 'D'];
  const engineLabels = {
    A: 'A — Legacy Mean-Lab / ΔE76',
    B: 'B — Cell-wise CIEDE2000',
    C: 'C — Edge-Aware ICM',
    D: 'D — SLIC Region-Aware ICM',
  };

  const cardsHtml = engineKeys
    .map((k) => {
      const m = metricsObj[k] || {};
      const isActive = k === run.engine;
      const isSelected = k === chosenEngine;
      return `
        <div class="engine-card ${isSelected ? 'selected' : ''}">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
            <strong style="font-size:13px">${esc(engineLabels[k])}</strong>
            ${isActive ? '<span class="status-text status-approved" style="font-size:11px">Run Primary</span>' : `<button class="btn-secondary btn-sm" onclick="selectEngineCard('${k}')">Use ${k}</button>`}
          </div>
          <div class="engine-previews">
            <img data-image-src="${esc(basePreview)}engine_${k}/color_preview.png" alt="Engine ${k} Color">
            <img data-image-src="${esc(basePreview)}engine_${k}/numbered_preview.png" alt="Engine ${k} Numbered">
          </div>
          <div class="meta-line tabular" style="font-size:12px">
            <span>ΔE00: <strong>${fmtNum(m.DeltaE00_mean_vs_source)}</strong></span>
            <span>·</span>
            <span>SSIM: <strong>${fmtNum(m.SSIM_vs_source, 3)}</strong></span>
            <span>·</span>
            <span>Edge F1: <strong>${fmtNum(m.Edge_F1_1px, 3)}</strong></span>
            <span>·</span>
            <span>Colors: <strong>${esc(m.colors_used ?? '—')}/21</strong></span>
          </div>
        </div>
      `;
    })
    .join('');

  const metricsRows = engineKeys
    .map((k) => {
      const m = metricsObj[k] || {};
      return `
        <tr>
          <td><strong>${esc(k)}</strong>${k === run.engine ? ' (Active)' : ''}</td>
          <td class="num">${fmtNum(m.DeltaE00_mean_vs_source)}</td>
          <td class="num">${fmtNum(m.DeltaE00_p95_vs_source)}</td>
          <td class="num">${fmtNum(m.SSIM_vs_source, 3)}</td>
          <td class="num">${fmtNum(m.Edge_F1_1px, 3)}</td>
          <td class="num">${esc(m.colors_used ?? '—')}</td>
          <td class="num">${fmtNum(m.singleton_ratio_pct, 1)}%</td>
          <td class="num">${fmtNum(m.transition_rate_pct, 1)}%</td>
          <td class="num">${fmtNum(m.runtime_seconds, 2)}s</td>
        </tr>
      `;
    })
    .join('');

  let stabilityHtml = '';
  if (Array.isArray(run.stability) && run.stability.length > 0) {
    stabilityHtml = `
      <h4 style="margin:18px 0 8px">±1 L* Perturbation Stability</h4>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Engine</th>
              <th class="num">L* -1 Agreement</th>
              <th class="num">L* +1 Agreement</th>
              <th class="num">Mean Stability</th>
            </tr>
          </thead>
          <tbody>
            ${run.stability
              .map(
                (row) => `
              <tr>
                <td>${esc(row.Engine)}</td>
                <td class="num">${fmtNum(row['Agreement after L* -1'], 2)}%</td>
                <td class="num">${fmtNum(row['Agreement after L* +1'], 2)}%</td>
                <td class="num"><strong>${fmtNum(row['Mean stability %'], 2)}%</strong></td>
              </tr>
            `,
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  const allWarnings = [...(Array.isArray(run.warnings) ? run.warnings : [])];
  const resolvedGridCols = Number(run.params?.params?.grid_cols);
  if (
    Number.isFinite(resolvedGridCols) &&
    Number.isFinite(asset.side_by_side_max_cols) &&
    resolvedGridCols > asset.side_by_side_max_cols &&
    !allWarnings.some((w) => w.includes('side_by_side'))
  ) {
    allWarnings.push(
      `grid_cols (${resolvedGridCols}) exceeds the 3 mm cell limit for side_by_side book layout (max ${asset.side_by_side_max_cols}).`,
    );
  }

  const warningsHtml =
    allWarnings.length > 0
      ? `<div class="notice-warning"><strong>Notice:</strong> ${allWarnings.map((w) => esc(w)).join(' · ')}</div>`
      : '';

  const selMetrics = metricsObj[run.engine] || run.metrics?.selected_metrics || {};
  const autoSel = run.auto_selection || run.metrics?.auto_selection || null;
  const analysis = run.analysis || null;
  let whyHtml = '';
  if (analysis || autoSel || run.resolved_preset) {
    const presetLabel =
      (run.resolved_preset && state.mappingMeta?.presets?.[run.resolved_preset]?.label_en) ||
      run.resolved_preset ||
      run.preset ||
      'Custom';
    const confText = run.confidence && run.confidence !== 'not_computed' ? ` (${run.confidence} confidence)` : '';
    const reasonParts = [analysis?.reason, autoSel?.reason].filter(Boolean);
    whyHtml = `
      <div class="why-box">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <strong>Why this setting</strong>
          <span class="mono" style="font-size:11px;color:var(--text-muted)">
            ${analysis?.image_type ? `${esc(analysis.image_type)} · ` : ''}Preset: ${esc(presetLabel)} · Engine ${esc(run.engine)}${esc(confText)}
          </span>
        </div>
        <div class="why-box-grid tabular">
          <span>SSIM: <strong>${fmtNum(selMetrics.SSIM_vs_source, 3)}</strong></span>
          <span>Edge F1: <strong>${fmtNum(selMetrics.Edge_F1_1px, 3)}</strong></span>
          <span>Mean ΔE00: <strong>${fmtNum(selMetrics.DeltaE00_mean_vs_source, 2)}</strong></span>
          <span>Grid: <strong>${esc(resolvedGridCols || '—')} cols</strong></span>
        </div>
        ${reasonParts.length ? `<div style="margin-top:6px;font-size:12px;color:var(--text-secondary)">${esc(reasonParts.join(' · '))}</div>` : ''}
      </div>
    `;
  }

  let maskHtml = '';
  if (run.has_mask && run.mask_url) {
    const usedBgMode = run.params?.params?.bg_mode || 'simple';
    const otherBgMode = usedBgMode === 'ai' ? 'simple' : 'ai';
    const otherBgLabel = otherBgMode === 'ai' ? 'Try AI mode' : 'Try Simple mode';
    maskHtml = `
      <div class="mask-preview-box">
        <img data-image-src="${esc(run.mask_url)}" alt="Foreground mask">
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:13px">Foreground Mask (${esc(usedBgMode)} mode)</div>
          <div style="font-size:12px;color:var(--text-secondary)">Background cells are mapped to White (05); metrics are evaluated on foreground only. Mask looks wrong → try the other mode.</div>
        </div>
        <button class="btn-secondary btn-sm" onclick="quickSwitchBgMode('${esc(otherBgMode)}')">${esc(otherBgLabel)}</button>
      </div>
    `;
  }

  panel.innerHTML = `${headerHtml}
    ${warningsHtml}
    ${whyHtml}
    ${maskHtml}
    <div class="split-2" style="margin-bottom:16px">
      <div class="surface" style="padding:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <h4>Source Image</h4>
          <span class="mono" style="font-size:11px;color:var(--text-muted)">Run ${esc(run.id)}</span>
        </div>
        <img data-image-src="${esc(asset.source_url)}" alt="Source" style="width:100%;max-height:260px;object-fit:contain;background:var(--bg-subtle);border-radius:6px">
      </div>
      <div class="surface" style="padding:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <h4>Primary Output (Engine ${esc(run.engine)})</h4>
          <div style="display:flex;gap:6px">
            <button class="btn-secondary btn-sm" onclick="downloadFile('${esc(basePreview)}color_preview.png', '${esc(asset.logical_name)}_color.png')">Color PNG</button>
            <button class="btn-secondary btn-sm" onclick="downloadFile('${esc(basePreview)}numbered_preview.png', '${esc(asset.logical_name)}_numbered.png')">Numbered PNG</button>
          </div>
        </div>
        <div class="engine-previews" style="margin:0">
          <img data-image-src="${esc(basePreview)}color_preview.png" alt="Primary Color" style="height:240px">
          <img data-image-src="${esc(basePreview)}numbered_preview.png" alt="Primary Numbered" style="height:240px">
        </div>
      </div>
    </div>

    <h4 style="margin-bottom:4px">4-Engine Comparison (A–D)</h4>
    <p class="page-subtitle">Compare color fidelity, edge preservation, and numbered cell layouts side by side.</p>
    <div class="engine-grid">${cardsHtml}</div>

    <h4 style="margin:18px 0 8px">Engine Quantitative Metrics</h4>
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Engine</th>
            <th class="num">Mean ΔE00</th>
            <th class="num">P95 ΔE00</th>
            <th class="num">SSIM</th>
            <th class="num">Edge F1</th>
            <th class="num">Colors</th>
            <th class="num">Singletons</th>
            <th class="num">Transitions</th>
            <th class="num">Runtime</th>
          </tr>
        </thead>
        <tbody>${metricsRows}</tbody>
      </table>
    </div>
    ${stabilityHtml}
  `;
  hydrateImages(panel);
}

// --- Review Modal ---

function openReviewModal(assetId, action) {
  const asset = state.assets.find((a) => a.id === assetId);
  if (!asset) return;
  state.reviewTarget = { assetId, action };
  const titleEl = document.getElementById('reviewModalTitle');
  const subEl = document.getElementById('reviewModalSubtitle');
  const btnEl = document.getElementById('reviewConfirmBtn');
  const noteEl = document.getElementById('reviewNoteInput');
  if (noteEl) noteEl.value = '';
  if (titleEl) titleEl.textContent = action === 'approve' ? 'Approve Artwork Output' : 'Reject Artwork Output';
  if (subEl) {
    subEl.textContent =
      action === 'approve'
        ? `Approve "${asset.logical_name}" (${asset.id}) for print-ready book assembly.`
        : `Reject "${asset.logical_name}" (${asset.id}) and keep it out of book generation until reprocessed.`;
  }
  if (btnEl) {
    btnEl.textContent = action === 'approve' ? 'Approve Artwork' : 'Reject Artwork';
    btnEl.className = action === 'approve' ? 'btn-primary' : 'btn-danger';
  }
  document.getElementById('reviewModal')?.classList.add('open');
}

async function submitReviewAction() {
  if (!state.reviewTarget) return;
  const { assetId, action } = state.reviewTarget;
  const note = (document.getElementById('reviewNoteInput')?.value || '').trim();
  try {
    await api(`/api/assets/${assetId}/review`, {
      method: 'POST',
      body: JSON.stringify({ action, note }),
    });
    closeModal('reviewModal');
    showToast(`Artwork ${action === 'approve' ? 'approved' : 'rejected'}.`);
    await refreshAll();
  } catch (err) {
    showToast(err.message || 'Failed to save review.', true);
  }
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
}

function openConfirmModal({ title, body, confirmLabel, buttonClass, onConfirm }) {
  state.confirmAction = onConfirm;
  const titleEl = document.getElementById('confirmModalTitle');
  const bodyEl = document.getElementById('confirmModalBody');
  const btnEl = document.getElementById('confirmModalBtn');
  if (titleEl) titleEl.textContent = title;
  if (bodyEl) bodyEl.textContent = body;
  if (btnEl) {
    btnEl.textContent = confirmLabel;
    btnEl.className = buttonClass || 'btn-danger';
  }
  document.getElementById('confirmModal')?.classList.add('open');
}

async function executeConfirmModal() {
  const fn = state.confirmAction;
  if (!fn) return;
  closeModal('confirmModal');
  state.confirmAction = null;
  await fn();
}

function confirmDeleteAssets(assetIds, label) {
  if (!Array.isArray(assetIds) || assetIds.length === 0) return;
  const count = assetIds.length;
  const subject = count === 1 && label ? `"${label}"` : `${count} selected artwork${count === 1 ? '' : 's'}`;
  openConfirmModal({
    title: 'Delete from Main Library',
    body: `Permanently delete ${subject}? This removes the original image file, all processing runs, and any project assignment. This cannot be undone.`,
    confirmLabel: 'Delete Permanently',
    buttonClass: 'btn-danger',
    onConfirm: async () => {
      try {
        if (count === 1) {
          await api(`/api/assets/${assetIds[0]}`, { method: 'DELETE' });
        } else {
          await api('/api/assets/delete', {
            method: 'POST',
            body: JSON.stringify({ asset_ids: assetIds }),
          });
        }
        assetIds.forEach((id) => {
          state.selectedInboxIds.delete(id);
          state.selectedLibraryIds.delete(id);
          state.selectedProjectAssetIds.delete(id);
          if (state.selectedLabAssetId === id) state.selectedLabAssetId = '';
        });
        showToast(`Permanently deleted ${count} artwork${count === 1 ? '' : 's'} from Main Library.`);
        await refreshAll();
      } catch (err) {
        showToast(err.message || 'Failed to delete artwork.', true);
      }
    },
  });
}

function confirmDeleteSelectedInbox() {
  confirmDeleteAssets(Array.from(state.selectedInboxIds));
}

function confirmDeleteSelectedLibrary() {
  confirmDeleteAssets(Array.from(state.selectedLibraryIds));
}

function confirmDeleteSelectedProject() {
  confirmDeleteAssets(Array.from(state.selectedProjectAssetIds));
}

function confirmRemoveFromProject(projectId, assetIds, label) {
  if (!projectId || !Array.isArray(assetIds) || assetIds.length === 0) return;
  const proj = state.projects.find((p) => p.id === projectId);
  const projName = proj?.name || projectId;
  const count = assetIds.length;
  const subject = count === 1 && label ? `"${label}"` : `${count} selected artwork${count === 1 ? '' : 's'}`;
  openConfirmModal({
    title: 'Remove Artwork from Project',
    body: `Remove ${subject} from project "${projName}"? The artwork will NOT be deleted—its asset ID, source file, and processing runs remain safely in your Artwork Library and Artwork Inbox.`,
    confirmLabel: 'Remove from Project',
    buttonClass: 'btn-primary',
    onConfirm: async () => {
      try {
        await api(`/api/projects/${projectId}/remove-assets`, {
          method: 'POST',
          body: JSON.stringify({ asset_ids: assetIds }),
        });
        assetIds.forEach((id) => state.selectedProjectAssetIds.delete(id));
        showToast(`Removed ${count} artwork${count === 1 ? '' : 's'} from "${projName}" and returned to Artwork Inbox.`);
        await refreshAll();
      } catch (err) {
        showToast(err.message || 'Failed to remove artwork from project.', true);
      }
    },
  });
}

function confirmRemoveSelectedFromProject(projectId) {
  confirmRemoveFromProject(projectId, Array.from(state.selectedProjectAssetIds));
}

// --- 6. Books ---

function renderBooksView() {
  const projSel = document.getElementById('bookProjectSelect');
  if (projSel) {
    const prev = projSel.value;
    if (state.projects.length === 0) {
      projSel.innerHTML = '<option value="">No projects created yet</option>';
    } else {
      projSel.innerHTML = state.projects
        .map((p) => `<option value="${esc(p.id)}">${esc(p.name)} (${p.approved_count} approved)</option>`)
        .join('');
      if (prev && state.projects.some((p) => p.id === prev)) {
        projSel.value = prev;
      } else if (state.selectedProjectId && state.projects.some((p) => p.id === state.selectedProjectId)) {
        projSel.value = state.selectedProjectId;
      }
    }
  }
  renderBookAssetPicker();
  renderBooksList();
}

function renderBookAssetPicker() {
  const picker = document.getElementById('bookAssetPicker');
  const noticeEl = document.getElementById('bookPreflightNotice');
  const projectId = document.getElementById('bookProjectSelect')?.value || '';
  if (!picker) return;

  if (!projectId) {
    picker.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:13px">Create a project and assign approved artworks first.</div>';
    if (noticeEl) noticeEl.innerHTML = '';
    return;
  }

  const approvedInProj = state.assets.filter((a) => a.project_id === projectId && a.status === 'approved');
  if (approvedInProj.length === 0) {
    picker.innerHTML = `
      <div style="padding:12px;color:var(--text-muted);font-size:13px">
        No approved artworks in this project yet. Assign artworks from Artwork Inbox, process them in Processing Lab, and approve their outputs.
      </div>
    `;
    if (noticeEl) noticeEl.innerHTML = '';
    return;
  }

  picker.innerHTML = approvedInProj
    .map((a) => {
      const cols = Number(a.latest_run?.params?.params?.grid_cols);
      const maxCols = a.side_by_side_max_cols;
      const exceeds = Number.isFinite(cols) && Number.isFinite(maxCols) && cols > maxCols;
      return `
      <label style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 9px;background:var(--bg-surface);border:1px solid ${exceeds ? '#fde68a' : 'var(--border-hairline)'};border-radius:6px;cursor:pointer">
        <span style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" class="book-asset-chk" value="${esc(a.id)}" checked onchange="updateBookPreflightNotice()" style="width:auto">
          <span><strong>${esc(a.logical_name)}</strong> (v${a.version})</span>
        </span>
        <span class="mono" style="font-size:11px;color:${exceeds ? '#92400e' : 'var(--text-muted)'}">Engine ${esc(a.latest_run?.engine || 'D')}${Number.isFinite(cols) ? ` · ${cols} cols` : ''}${exceeds ? ` (> ${maxCols} max)` : ''}</span>
      </label>
    `;
    })
    .join('');

  updateBookPreflightNotice();
}

function updateBookPreflightNotice() {
  const noticeEl = document.getElementById('bookPreflightNotice');
  if (!noticeEl) return;
  const checkedIds = new Set(Array.from(document.querySelectorAll('.book-asset-chk:checked')).map((el) => el.value));
  const warnings = [];
  for (const id of checkedIds) {
    const a = state.assets.find((x) => x.id === id);
    if (!a) continue;
    const cols = Number(a.latest_run?.params?.params?.grid_cols);
    const maxCols = a.side_by_side_max_cols;
    if (Number.isFinite(cols) && Number.isFinite(maxCols) && cols > maxCols) {
      warnings.push(`${a.logical_name}: grid_cols (${cols}) exceeds 3 mm side_by_side limit (max ${maxCols})`);
    }
  }
  if (warnings.length === 0) {
    noticeEl.innerHTML = '';
    return;
  }
  noticeEl.innerHTML = `
    <div class="notice-warning" style="margin-bottom:0">
      <strong>Preflight warning (3 mm cell minimum):</strong> ${warnings.map((w) => esc(w)).join(' · ')}. Reprocess with a lower grid_cols or Auto preset before building a side-by-side book.
    </div>
  `;
}

async function generateBook() {
  const projectId = document.getElementById('bookProjectSelect')?.value || '';
  const title = (document.getElementById('bookTitleInput')?.value || '').trim();
  const subtitle = (document.getElementById('bookSubtitleInput')?.value || '').trim();
  const checked = Array.from(document.querySelectorAll('.book-asset-chk:checked')).map((el) => el.value);

  if (!projectId) {
    showToast('Select a project first.', true);
    return;
  }
  if (!title) {
    showToast('Enter a book title.', true);
    return;
  }
  if (checked.length === 0) {
    showToast('Select at least one approved artwork.', true);
    return;
  }

  try {
    const book = await api('/api/books', {
      method: 'POST',
      body: JSON.stringify({
        project_id: projectId,
        asset_ids: checked,
        title,
        subtitle,
      }),
    });
    showToast(`Queued book build "${book.title}".`);
    await refreshAll();
  } catch (err) {
    showToast(err.message || 'Failed to queue book generation.', true);
  }
}

function renderBooksList() {
  const listEl = document.getElementById('booksList');
  if (!listEl) return;

  if (state.books.length === 0) {
    listEl.innerHTML = '<div class="empty-state"><h3>No books generated yet</h3><p>Your Side-by-Side and Full-Page A4 PDFs, plus the layout preflight report, will appear here.</p></div>';
    return;
  }

  listEl.innerHTML = state.books
    .map(
      (b) => `
      <div style="border:1px solid var(--border-hairline);border-radius:8px;padding:14px;background:var(--bg-canvas)">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:6px">
          <div>
            <strong>${esc(b.title)}</strong>
            <div style="font-size:12px;color:var(--text-secondary)">${esc(b.subtitle || '')} · Project: ${esc(b.project_name || b.project_id)}</div>
          </div>
          <span class="status-text status-${esc(b.status)}">${esc(statusLabel(b.status))}</span>
        </div>
        <div class="meta-line mono" style="font-size:11px;margin-bottom:10px">
          <span>ID: ${esc(b.id)}</span>
          <span>·</span>
          <span>${esc(fmtDate(b.created_at))}</span>
        </div>
        ${b.error ? `<div style="font-size:12px;color:var(--status-error);margin-bottom:10px">${esc(b.error)}</div>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${b.book_url ? `<button class="btn-primary btn-sm" onclick="downloadFile('${esc(b.book_url)}', '${esc(b.title)}_side_by_side_A4.pdf')">Download Side-by-Side A4 · Landscape</button>` : ''}
          ${b.answer_key_url ? `<button class="btn-secondary btn-sm" onclick="downloadFile('${esc(b.answer_key_url)}', '${esc(b.title)}_full_page_A4.pdf')">Download Full-Page A4 · Portrait</button>` : ''}
          ${b.report_url ? `<button class="btn-secondary btn-sm" onclick="downloadFile('${esc(b.report_url)}', '${esc(b.title)}_dual_layout_report.json')">Download Layout Report</button>` : ''}
        </div>
      </div>
    `,
    )
    .join('');
}

// --- 7. Processing History ---

async function loadHistory() {
  const wrap = document.getElementById('historyContainer');
  if (!wrap) return;
  try {
    const runs = await api('/api/runs?limit=100');
    state.runs = runs || [];
    if (state.runs.length === 0) {
      wrap.innerHTML = '<div class="empty-state" style="border:none"><h3>No processing runs yet</h3><p>Process any artwork from Artwork Inbox or Processing Lab to see engine metrics here.</p></div>';
      return;
    }

    wrap.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Artwork</th>
            <th>Location</th>
            <th>Engine</th>
            <th>State</th>
            <th class="num">Mean ΔE00</th>
            <th class="num">SSIM</th>
            <th class="num">Colors</th>
            <th class="num">Runtime</th>
            <th>Created</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${state.runs
            .map((r) => {
              const m = r.metrics?.selected_metrics || {};
              return `
              <tr>
                <td><strong>${esc(r.asset_name)}</strong> (v${esc(r.asset_version)})<div class="mono" style="font-size:11px;color:var(--text-muted)">${esc(r.id)}</div></td>
                <td>${esc(r.project_name || 'Artwork Inbox')}</td>
                <td><strong>Engine ${esc(r.engine)}</strong></td>
                <td><span class="status-text status-${esc(r.state)}">${esc(statusLabel(r.state))}</span></td>
                <td class="num">${fmtNum(m.DeltaE00_mean_vs_source)}</td>
                <td class="num">${fmtNum(m.SSIM_vs_source, 3)}</td>
                <td class="num">${esc(m.colors_used ?? '—')}/21</td>
                <td class="num">${fmtNum(r.metrics?.total_runtime_seconds, 2)}s</td>
                <td class="tabular">${esc(fmtDate(r.created_at))}</td>
                <td><button class="btn-secondary btn-sm" onclick="openInLab('${esc(r.asset_id)}')">Inspect</button></td>
              </tr>
            `;
            })
            .join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    showToast(err.message || 'Failed to load processing history.', true);
  }
}

// --- 8. Audit Log ---

async function loadAudit() {
  const wrap = document.getElementById('auditContainer');
  if (!wrap) return;
  try {
    const rows = await api('/api/audit?limit=120');
    state.audit = rows || [];
    if (state.audit.length === 0) {
      wrap.innerHTML = '<div class="empty-state" style="border:none"><h3>No audit events yet</h3><p>All uploads, project assignments, processing jobs, reviews, and book builds are logged here.</p></div>';
      return;
    }

    wrap.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Entity</th>
            <th>Entity ID</th>
            <th>Action</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          ${state.audit
            .map(
              (ev) => `
            <tr>
              <td class="tabular">${esc(fmtDate(ev.created_at))}</td>
              <td>${esc(ev.entity_type)}</td>
              <td class="mono">${esc(ev.entity_id)}</td>
              <td><strong>${esc(ev.action)}</strong></td>
              <td>${esc(ev.detail || '—')}</td>
            </tr>
          `,
            )
            .join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    showToast(err.message || 'Failed to load audit log.', true);
  }
}

// --- 9. System Status ---

async function loadSystemStatus() {
  const wrap = document.getElementById('systemStatusContainer');
  if (!wrap) return;
  try {
    const s = await api('/api/system-status');
    state.systemStatus = s;
    const paletteColors = s.palette?.colors || [];

    wrap.innerHTML = `
      <div class="split-2" style="margin-bottom:16px">
        <div class="surface">
          <h3>Service Overview</h3>
          <div style="display:grid;gap:8px;margin-top:12px;font-size:13px">
            <div style="display:flex;justify-content:space-between"><span>Application</span><strong>${esc(s.service)} v${esc(s.version)}</strong></div>
            <div style="display:flex;justify-content:space-between"><span>Status</span><span class="status-text status-approved">${esc(s.status)}</span></div>
            <div style="display:flex;justify-content:space-between"><span>Independent Artwork Inbox</span><strong>${s.upload?.independent_inbox_enabled ? 'Enabled' : 'Disabled'}</strong></div>
            <div style="display:flex;justify-content:space-between"><span>Supported Formats</span><strong>${esc((s.upload?.formats || []).join(', '))}</strong></div>
            <div style="display:flex;justify-content:space-between"><span>Max Upload Size</span><strong>${esc(s.upload?.max_upload_mb)} MB / image</strong></div>
          </div>
        </div>
        <div class="surface">
          <h3>Mapping Engines</h3>
          <div style="display:grid;gap:8px;margin-top:12px;font-size:13px">
            ${(s.engines || [])
              .map(
                (e) => `
              <div style="display:flex;justify-content:space-between">
                <span>${esc(e.name)}</span>
                <span class="status-text status-approved">${esc(e.status)}</span>
              </div>
            `,
              )
              .join('')}
          </div>
        </div>
      </div>
      <div class="surface">
        <h3>Locked Production Palette (${esc(s.palette?.id)} · ${esc(s.palette?.count)} colors)</h3>
        <p class="page-subtitle">All four mapping engines quantize exclusively to this frozen 21-color palette.</p>
        <div class="palette-grid">
          ${paletteColors
            .map(
              (c) => `
            <div class="swatch-item">
              <div class="swatch-box" style="background:${esc(c.hex)}"></div>
              <div style="min-width:0">
                <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.id)} · ${esc(c.name)}</div>
                <div class="mono" style="font-size:11px;color:var(--text-muted)">${esc(c.hex)}</div>
              </div>
            </div>
          `,
            )
            .join('')}
        </div>
      </div>
    `;
  } catch (err) {
    showToast(err.message || 'Failed to load system status.', true);
  }
}

// --- Bootstrap ---

document.addEventListener('DOMContentLoaded', async () => {
  initUploadOptionsFromStorage();
  setupDropzone();

  // No account, sign-in screen, or external identity provider: this is a single local workspace.
  state.user = { uid: 'chromabook-local-workspace', email: 'Local workspace' };
  const workspace = document.getElementById('workspaceContent');
  if (workspace) workspace.style.display = 'block';

  navigate('inbox');
  await refreshAll();
});
