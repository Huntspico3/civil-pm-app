const state = {
  gateToken: localStorage.getItem('civilpm_gate_token') || null,
  sessionToken: localStorage.getItem('civilpm_session_token') || null,
  users: [],
  roles: [],
  stages: [],
  taskStatuses: [],
  externalContactCategories: [],
  view: 'dashboard', // 'dashboard' | 'projects' | 'project' | 'project-board' | 'project-rfis' | 'project-documents' | 'project-snags' | 'contacts' | 'team' | 'settings' | 'portfolio' | 'my-tasks' | 'offsite-reports'
  activeProjectId: null,
  dashboardGroupBy: 'project',
  myTasksUserId: null,
  myOpenRfiCount: 0,
  me: null
};

const root = document.getElementById('app');

function requireGate() {
  state.gateToken = null;
  localStorage.removeItem('civilpm_gate_token');
  renderGateScreen();
}

async function api(path, opts = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (state.gateToken) headers['x-gate-token'] = state.gateToken;
  if (state.sessionToken) headers['x-session-token'] = state.sessionToken;
  const res = await fetch('/api' + path, Object.assign({}, opts, { headers }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (data.gateRequired) requireGate();
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

async function apiUpload(path, formData) {
  const headers = {};
  if (state.gateToken) headers['x-gate-token'] = state.gateToken;
  if (state.sessionToken) headers['x-session-token'] = state.sessionToken;
  const res = await fetch('/api' + path, { method: 'POST', headers, body: formData });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (data.gateRequired) requireGate();
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

// Uploaded files under /uploads now require the same gate+session auth as the
// API — but a plain <img src="..."> or <audio src="..."> can't attach custom
// headers, so we fetch the file ourselves (with auth) and hand the browser a
// local blob URL to display instead.
async function authenticatedBlobUrl(url) {
  const headers = {};
  if (state.gateToken) headers['x-gate-token'] = state.gateToken;
  if (state.sessionToken) headers['x-session-token'] = state.sessionToken;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error('Could not load file');
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

function statusClass(status) {
  return 'status-' + status.replace(/\s+/g, '-');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// A friendly icon + message for any list/page with nothing to show yet, used
// consistently everywhere instead of a bare line of text.
function emptyStateHtml(message) {
  return `
    <div class="empty-state">
      <svg class="empty-state-icon" viewBox="0 0 24 24"><path d="M3 7l2.5-3.5h13L21 7"/><path d="M3 7v12a1.5 1.5 0 0 0 1.5 1.5h15A1.5 1.5 0 0 0 21 19V7"/><path d="M3 7h18"/><path d="M9 11.5a3 3 0 0 0 6 0"/></svg>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

// Same empty state, sized to sit inside a table row.
function emptyStateRowHtml(message, colspan) {
  return `<tr><td colspan="${colspan}">${emptyStateHtml(message)}</td></tr>`;
}

const STAT_ICONS = {
  tasks: '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1.4 1.4L8 4.8"/><path d="M4 12l1.4 1.4L8 10.8"/><path d="M4 18l1.4 1.4L8 16.8"/></svg>',
  rfi: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.9.5-1.5 1.1-1.5 2.2"/><path d="M12 17h.01"/></svg>',
  calendar: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>',
  team: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M2.5 20c.9-3.2 3.4-5 6.5-5s5.6 1.8 6.5 5"/><circle cx="17" cy="9" r="2.2"/><path d="M15 14.2c2.4.4 4 1.8 4.6 4"/></svg>'
};

function statCardHtml(iconKey, value, label) {
  return `
    <div class="stat-card">
      <div class="stat-icon">${STAT_ICONS[iconKey] || ''}</div>
      <div class="stat-value">${value}</div>
      <div class="stat-label">${escapeHtml(label)}</div>
    </div>
  `;
}

// ---------------- TASK PROGRESS BAR (shared by Task Board + task modal) ----------------
// Same visual language as the Portfolio Timeline's bars, and the same
// click/drag-to-set interaction as its progress-drag gesture — just applied
// to a single task instead of a whole project.

function progressColor(pct) {
  if (pct >= 70) return 'var(--success)';
  if (pct >= 40) return 'var(--warning)';
  return 'var(--danger)';
}

function taskProgressBarHtml(task, editable, size) {
  const progress = task.progress || 0;
  const sizeClass = size === 'lg' ? ' task-progress-bar-lg' : '';
  return `
    <div class="task-progress-row">
      <div class="task-progress-bar${sizeClass}${editable ? ' task-progress-bar-editable' : ''}" data-progress-task="${task.id}" data-editable="${editable}" draggable="false">
        <div class="task-progress-bar-fill" style="width:${progress}%; background:${progressColor(progress)};"></div>
      </div>
      <span class="task-progress-label" data-progress-label="${task.id}">${progress}%</span>
    </div>
  `;
}

// Wires up click/drag-to-set on every editable progress bar found inside
// `container`. `onUpdated(taskId)` is called after a successful save so the
// caller can refresh whatever else depends on it (e.g. re-render the board).
function bindTaskProgressBars(container, onUpdated) {
  container.querySelectorAll('.task-progress-bar-editable').forEach(bar => {
    const taskId = bar.dataset.progressTask;
    const fillEl = bar.querySelector('.task-progress-bar-fill');
    const labelEl = container.querySelector(`[data-progress-label="${taskId}"]`);

    function computeProgress(clientX, rect) {
      const relativeX = clientX - rect.left;
      return Math.max(0, Math.min(100, Math.round((relativeX / rect.width) * 100)));
    }

    function applyVisual(value) {
      fillEl.style.width = value + '%';
      fillEl.style.background = progressColor(value);
      if (labelEl) labelEl.textContent = value + '%';
    }

    // Stop both the mousedown AND the resulting click from bubbling up —
    // otherwise a plain click-without-drag still fires a click event on the
    // card/modal afterward (mousedown and click are separate events), which
    // would unexpectedly trigger whatever the card's own click does.
    bar.addEventListener('click', (e) => e.stopPropagation());
    bar.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = bar.getBoundingClientRect();
      let value = computeProgress(e.clientX, rect);
      applyVisual(value);

      function onMove(ev) {
        value = computeProgress(ev.clientX, rect);
        applyVisual(value);
      }
      async function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        try {
          await api('/tasks/' + taskId, { method: 'PATCH', body: JSON.stringify({ progress: value }) });
          if (onUpdated) onUpdated(taskId);
        } catch (err) {
          alert(err.message);
          if (onUpdated) onUpdated(taskId);
        }
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}

// ---------------- TASK LIST CONTROLS (search/filter/sort/pagination) ----------------
// One shared search+filter+sort+pagination bar, used identically by the Task
// Board, My Tasks, and a project's List View, all backed by the same
// GET /api/tasks endpoint — so results behave the same everywhere regardless
// of which view you're looking at.

function defaultTaskFilters() {
  return {
    search: '', assigneeId: '', status: '', requiredRole: '',
    progressMin: '', progressMax: '', sortBy: '', sortDir: 'asc',
    overdue: false, filterProjectId: '', filterProjectName: '',
    page: 1, pageSize: 50
  };
}

function hasActiveTaskFilters(filters) {
  return !!(filters.search || filters.assigneeId || filters.status || filters.requiredRole ||
    filters.progressMin !== '' || filters.progressMax !== '' || filters.sortBy ||
    filters.overdue || filters.filterProjectId);
}

// Small removable "chips" summarizing whatever's currently filtering the
// list, whichever way each one was set — a dropdown, the overdue checkbox,
// or an AI-interpreted natural-language query. Every chip's × clears just
// that one filter. `opts.lockedProjectId` (Task Board / a project's List
// View, already scoped to one project) suppresses the project chip, since
// project isn't a removable filter there — it's the page you're on.
function activeFilterPillsHtml(filters, opts) {
  const pills = [];
  if (!opts.lockedProjectId && filters.filterProjectId) {
    pills.push({ key: 'filterProjectId', label: `Project: ${filters.filterProjectName || filters.filterProjectId}` });
  }
  if (filters.search) pills.push({ key: 'search', label: `"${filters.search}"` });
  if (filters.assigneeId === 'unassigned') {
    pills.push({ key: 'assigneeId', label: 'Unassigned' });
  } else if (filters.assigneeId) {
    const u = state.users.find(u => String(u.id) === String(filters.assigneeId));
    pills.push({ key: 'assigneeId', label: `Assignee: ${u ? u.name : filters.assigneeId}` });
  }
  if (filters.status) pills.push({ key: 'status', label: `Status: ${filters.status}` });
  if (filters.requiredRole) pills.push({ key: 'requiredRole', label: `Role: ${filters.requiredRole}` });
  if (filters.overdue) pills.push({ key: 'overdue', label: 'Overdue' });
  if (filters.progressMin !== '' || filters.progressMax !== '') {
    pills.push({ key: 'progress', label: `Progress: ${filters.progressMin !== '' ? filters.progressMin : 0}-${filters.progressMax !== '' ? filters.progressMax : 100}%` });
  }
  if (pills.length === 0) return '';
  return `
    <div class="filter-pills">
      ${pills.map(p => `
        <span class="filter-pill">
          ${escapeHtml(p.label)}
          <button type="button" class="filter-pill-remove" data-clear-filter="${p.key}" aria-label="Remove filter">&times;</button>
        </span>
      `).join('')}
    </div>
  `;
}

// `opts.showAssignee` hides the assignee filter on views that are already
// scoped to one person (e.g. My Tasks doesn't need to filter by assignee).
// `opts.lockedProjectId`, when set, tells the natural-language box not to
// bother interpreting a project name — the list is already scoped to one.
function taskFilterBarHtml(filters, opts = {}) {
  const showAssignee = opts.showAssignee !== false;
  return `
    <div class="nl-search-bar">
      <input type="text" class="nl-search-input" placeholder='Or ask in plain English — e.g. "overdue structural tasks"' />
      <button type="button" class="btn small nl-search-btn">Ask</button>
      <span class="hint nl-search-status"></span>
    </div>
    <div class="task-filter-bar">
      <input type="search" class="task-filter-search" placeholder="Search tasks…" value="${escapeHtml(filters.search)}" />
      ${showAssignee ? `
        <select class="task-filter-assignee">
          <option value="">Anyone</option>
          <option value="unassigned" ${filters.assigneeId === 'unassigned' ? 'selected' : ''}>Unassigned</option>
          ${state.users.map(u => `<option value="${u.id}" ${String(filters.assigneeId) === String(u.id) ? 'selected' : ''}>${escapeHtml(u.name)}</option>`).join('')}
        </select>
      ` : ''}
      <select class="task-filter-status">
        <option value="">Any status</option>
        ${state.taskStatuses.map(s => `<option value="${escapeHtml(s)}" ${filters.status === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
      </select>
      <select class="task-filter-role">
        <option value="">Any discipline</option>
        ${state.roles.map(r => `<option value="${escapeHtml(r)}" ${filters.requiredRole === r ? 'selected' : ''}>${escapeHtml(r)}</option>`).join('')}
      </select>
      <div class="task-filter-progress">
        <input type="number" class="task-filter-progress-min" min="0" max="100" placeholder="Min %" value="${escapeHtml(filters.progressMin)}" />
        <span>–</span>
        <input type="number" class="task-filter-progress-max" min="0" max="100" placeholder="Max %" value="${escapeHtml(filters.progressMax)}" />
      </div>
      <label class="task-filter-overdue-label">
        <input type="checkbox" class="task-filter-overdue" ${filters.overdue ? 'checked' : ''} /> Overdue only
      </label>
      <select class="task-filter-sort">
        <option value="">Sort: default</option>
        <option value="dueDate" ${filters.sortBy === 'dueDate' ? 'selected' : ''}>Due date</option>
        <option value="progress" ${filters.sortBy === 'progress' ? 'selected' : ''}>Progress</option>
        <option value="assignee" ${filters.sortBy === 'assignee' ? 'selected' : ''}>Assignee</option>
      </select>
      <select class="task-filter-sort-dir" ${filters.sortBy ? '' : 'disabled'}>
        <option value="asc" ${filters.sortDir === 'asc' ? 'selected' : ''}>&uarr; Asc</option>
        <option value="desc" ${filters.sortDir === 'desc' ? 'selected' : ''}>&darr; Desc</option>
      </select>
      ${hasActiveTaskFilters(filters) ? `<button type="button" class="btn small secondary task-filter-clear">Clear filters</button>` : ''}
    </div>
    ${activeFilterPillsHtml(filters, opts)}
  `;
}

function bindTaskFilterBar(container, filters, onChange, opts = {}) {
  // 'change' (not 'input') for every one of these — they're selects, or
  // number fields that should only re-render on blur/Enter, not per
  // keystroke (which would rebuild the DOM mid-type and drop focus).
  const bind = (selector, prop, transform) => {
    const el = container.querySelector(selector);
    if (!el) return;
    el.addEventListener('change', () => {
      filters[prop] = transform ? transform(el.value) : el.value;
      filters.page = 1;
      onChange();
    });
  };

  const search = container.querySelector('.task-filter-search');
  if (search) {
    let searchTimer = null;
    search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(async () => {
        filters.search = search.value;
        filters.page = 1;
        // onChange rebuilds the whole view (a fresh DOM node replaces this
        // one), so the browser drops focus on its own — put it back on the
        // new search box, cursor at the end, once the re-render lands.
        await onChange();
        const refreshed = container.querySelector('.task-filter-search');
        if (refreshed) {
          refreshed.focus();
          refreshed.setSelectionRange(refreshed.value.length, refreshed.value.length);
        }
      }, 300);
    });
  }
  bind('.task-filter-assignee', 'assigneeId');
  bind('.task-filter-status', 'status');
  bind('.task-filter-role', 'requiredRole');
  bind('.task-filter-progress-min', 'progressMin');
  bind('.task-filter-progress-max', 'progressMax');

  const overdue = container.querySelector('.task-filter-overdue');
  if (overdue) overdue.addEventListener('change', () => { filters.overdue = overdue.checked; filters.page = 1; onChange(); });

  const sortBy = container.querySelector('.task-filter-sort');
  if (sortBy) sortBy.addEventListener('change', () => { filters.sortBy = sortBy.value; onChange(); });
  const sortDir = container.querySelector('.task-filter-sort-dir');
  if (sortDir) sortDir.addEventListener('change', () => { filters.sortDir = sortDir.value; onChange(); });
  const clear = container.querySelector('.task-filter-clear');
  if (clear) clear.addEventListener('click', () => { Object.assign(filters, defaultTaskFilters()); onChange(); });

  container.querySelectorAll('[data-clear-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.clearFilter;
      if (key === 'progress') { filters.progressMin = ''; filters.progressMax = ''; }
      else if (key === 'filterProjectId') { filters.filterProjectId = ''; filters.filterProjectName = ''; }
      else if (key === 'overdue') { filters.overdue = false; }
      else { filters[key] = ''; }
      filters.page = 1;
      onChange();
    });
  });

  bindNlSearchBar(container, filters, opts, onChange);
}

// Submits the plain-English box to the AI query interpreter and maps the
// result onto the same filters object every other control here shares —
// each submission replaces the AI-controllable fields wholesale (a fresh
// search rather than merging onto whatever was set before), matching how a
// normal search box behaves. Any failure (a network hiccup, the model
// being unavailable, an unrecognized query) is never shown as an error —
// it just falls back to treating the raw text as a plain keyword search,
// since this is meant to be a low-stakes, best-effort convenience on top of
// the filters that already exist, not a feature that can block the page.
function bindNlSearchBar(container, filters, opts, onChange) {
  const input = container.querySelector('.nl-search-input');
  const btn = container.querySelector('.nl-search-btn');
  const statusEl = container.querySelector('.nl-search-status');
  if (!input || !btn) return;

  async function submit() {
    const query = input.value.trim();
    if (!query) return;
    btn.disabled = true;
    statusEl.textContent = 'Thinking…';
    try {
      const result = await api('/tasks/interpret', {
        method: 'POST',
        body: JSON.stringify({ query, projectId: opts.lockedProjectId || undefined })
      });
      const f = result.filters || {};
      filters.filterProjectId = f.projectId !== undefined ? f.projectId : '';
      filters.filterProjectName = result.matchedProjectName || '';
      filters.requiredRole = f.requiredRole || '';
      filters.status = f.status || '';
      filters.overdue = !!f.overdue;
      filters.assigneeId = f.assigneeId !== undefined ? f.assigneeId : '';
      filters.progressMin = typeof f.progressMin === 'number' ? f.progressMin : '';
      filters.progressMax = typeof f.progressMax === 'number' ? f.progressMax : '';
      filters.search = f.search || '';
    } catch (err) {
      filters.search = query;
    }
    filters.page = 1;
    statusEl.textContent = '';
    btn.disabled = false;
    // The re-rendered filter bar's NL box always starts blank (the template
    // never echoes back the last query), so there's nothing left to clear.
    onChange();
  }

  btn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
  });
}

// Builds the /api/tasks query string from a filters object plus any
// view-specific fixed params (e.g. projectId for a single project's views).
function taskQueryParams(filters, extra = {}) {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.assigneeId === 'unassigned') params.set('assigneeId', '');
  else if (filters.assigneeId) params.set('assigneeId', filters.assigneeId);
  if (filters.status) params.set('status', filters.status);
  if (filters.requiredRole) params.set('requiredRole', filters.requiredRole);
  if (filters.progressMin !== '') params.set('progressMin', filters.progressMin);
  if (filters.progressMax !== '') params.set('progressMax', filters.progressMax);
  if (filters.overdue) params.set('overdue', 'true');
  if (filters.filterProjectId) params.set('projectId', filters.filterProjectId);
  if (filters.sortBy) { params.set('sortBy', filters.sortBy); params.set('sortDir', filters.sortDir || 'asc'); }
  params.set('page', filters.page || 1);
  params.set('pageSize', filters.pageSize || 50);
  Object.entries(extra).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') params.set(k, v); });
  return params.toString();
}

function paginationBarHtml(page, totalPages, total, opts = {}) {
  if (opts.loadMore) {
    const loadedCount = Math.min(opts.loadedCount || total, total);
    if (page >= totalPages) return `<div class="pagination-bar"><span class="pagination-info">${total} task${total === 1 ? '' : 's'} shown</span></div>`;
    return `
      <div class="pagination-bar">
        <span class="pagination-info">Showing ${loadedCount} of ${total} tasks</span>
        <button type="button" class="btn small secondary pagination-next">Load more tasks</button>
      </div>
    `;
  }
  return `
    <div class="pagination-bar">
      <span class="pagination-info">${total} task${total === 1 ? '' : 's'} · page ${page} of ${totalPages}</span>
      <div class="pagination-controls">
        <button type="button" class="btn small secondary pagination-prev" ${page <= 1 ? 'disabled' : ''}>&larr; Prev</button>
        <button type="button" class="btn small secondary pagination-next" ${page >= totalPages ? 'disabled' : ''}>Next &rarr;</button>
      </div>
    </div>
  `;
}

function bindPaginationBar(container, filters, onChange, opts = {}) {
  const prev = container.querySelector('.pagination-prev');
  const next = container.querySelector('.pagination-next');
  if (prev) prev.addEventListener('click', () => { filters.page = Math.max(1, filters.page - 1); onChange(); });
  if (next) next.addEventListener('click', () => {
    if (opts.loadMore) filters.pageSize += opts.pageSize || 150;
    else filters.page += 1;
    onChange();
  });
}

function start() {
  if (!state.gateToken) {
    renderGateScreen();
    return;
  }
  boot();
}

async function boot() {
  state.roles = await api('/roles');
  state.stages = await api('/stages');
  state.taskStatuses = await api('/task-statuses');
  state.users = await api('/users');
  if (state.sessionToken) {
    try {
      state.me = await api('/me');
    } catch (e) {
      state.sessionToken = null;
      localStorage.removeItem('civilpm_session_token');
    }
  }
  if (state.me) await refreshMyOpenRfiCount();
  render();
}

async function refreshMyOpenRfiCount() {
  try {
    const data = await api('/my-rfis');
    state.myOpenRfiCount = data.rfis.length;
  } catch (e) {
    // non-critical — leave the last known count in place
  }
}

// ---------------- SHARED PASSWORD GATE ----------------

function renderGateScreen(errorMessage) {
  root.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <h1>Civil <span style="color:#1e3a5f">PM</span></h1>
        <p class="subtitle">Enter the shared access password to continue.</p>
        <form id="gate-form">
          <div><label>Password</label><input name="password" type="password" required autofocus /></div>
          <div id="gate-error" class="error-text">${errorMessage ? escapeHtml(errorMessage) : ''}</div>
          <button class="btn" type="submit">Continue</button>
        </form>
      </div>
    </div>
  `;

  root.querySelector('#gate-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const errBox = form.querySelector('#gate-error');
    errBox.textContent = '';
    try {
      const res = await fetch('/api/gate/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: form.password.value })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        errBox.textContent = data.error || 'Incorrect password';
        return;
      }
      state.gateToken = data.token;
      localStorage.setItem('civilpm_gate_token', data.token);
      boot();
    } catch (err) {
      errBox.textContent = 'Could not reach the server. Please try again.';
    }
  });
}

async function logout() {
  if (state.sessionToken) {
    try { await api('/logout', { method: 'POST' }); } catch (e) { /* best-effort */ }
  }
  state.sessionToken = null;
  state.me = null;
  state.myTasksUserId = null;
  state.myOpenRfiCount = 0;
  localStorage.removeItem('civilpm_session_token');
  render();
}

function setView(view, opts = {}) {
  state.view = view;
  if (opts.projectId !== undefined) state.activeProjectId = opts.projectId;
  render();
}

function render() {
  if (!state.sessionToken || !state.me) {
    renderLogin();
    return;
  }
  root.innerHTML = renderShell();
  bindShell();
}

// ---------------- LOGIN ----------------

function renderLogin(errorMessage) {
  root.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <h1>Civil <span style="color:#1e3a5f">PM</span></h1>
        <p class="subtitle">Log in with your email and password.</p>
        <form id="login-form">
          <div><label>Email</label><input name="email" type="email" required autofocus autocomplete="username" /></div>
          <div><label>Password</label><input name="password" type="password" required autocomplete="current-password" /></div>
          <div id="login-error" class="error-text">${errorMessage ? escapeHtml(errorMessage) : ''}</div>
          <button class="btn" type="submit">Log In</button>
        </form>
      </div>
    </div>
  `;

  root.querySelector('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const errBox = form.querySelector('#login-error');
    errBox.textContent = '';
    try {
      const data = await api('/login', {
        method: 'POST',
        body: JSON.stringify({ email: form.email.value, password: form.password.value })
      });
      state.sessionToken = data.token;
      state.myTasksUserId = null;
      localStorage.setItem('civilpm_session_token', data.token);
      await boot();
    } catch (err) {
      errBox.textContent = err.message;
    }
  });
}

// ---------------- SHELL ----------------

const NAV_ICONS = {
  'dashboard': '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  'my-tasks': '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1.4 1.4L8 4.8"/><path d="M4 12l1.4 1.4L8 10.8"/><path d="M4 18l1.4 1.4L8 16.8"/></svg>',
  'projects': '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>',
  'portfolio': '<svg viewBox="0 0 24 24"><path d="M4 20V10M12 20V4M20 20v-7"/></svg>',
  'offsite-reports': '<svg viewBox="0 0 24 24"><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.4"/></svg>',
  'contacts': '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.2"/><path d="M5 20c1.2-3.4 4-5 7-5s5.8 1.6 7 5"/></svg>',
  'external-contacts': '<svg viewBox="0 0 24 24"><path d="M5 21V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v16"/><path d="M13 21V9a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v12"/><path d="M8 8h.01M8 11h.01M8 14h.01M16 12h.01M16 15h.01"/></svg>',
  'team': '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M2.5 20c.9-3.2 3.4-5 6.5-5s5.6 1.8 6.5 5"/><circle cx="17" cy="9" r="2.2"/><path d="M15 14.2c2.4.4 4 1.8 4.6 4"/></svg>',
  'settings': '<svg viewBox="0 0 24 24"><path d="M10.3 2.5h3.4l.5 2.4a7.6 7.6 0 0 1 2 1.2l2.3-.9 1.7 3-1.9 1.5c.1.4.1.8.1 1.3s0 .9-.1 1.3l1.9 1.5-1.7 3-2.3-.9a7.6 7.6 0 0 1-2 1.2l-.5 2.4h-3.4l-.5-2.4a7.6 7.6 0 0 1-2-1.2l-2.3.9-1.7-3 1.9-1.5A7 7 0 0 1 5.6 12c0-.5 0-.9.1-1.3L3.8 9.2l1.7-3 2.3.9a7.6 7.6 0 0 1 2-1.2z"/><circle cx="12" cy="12" r="3"/></svg>'
};

function renderShell() {
  const nav = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'my-tasks', label: 'My Tasks' },
    { key: 'projects', label: 'Projects' },
    { key: 'portfolio', label: 'Portfolio Timeline' },
    { key: 'offsite-reports', label: 'Offsite Reports' },
    { key: 'contacts', label: 'Contacts' }
  ];
  if (state.me.isAdmin || state.me.isManager) nav.push({ key: 'external-contacts', label: 'External Contacts' });
  if (state.me.isAdmin) nav.push({ key: 'team', label: 'Team' });
  if (state.me.isAdmin) nav.push({ key: 'settings', label: 'Settings' });

  const navHtml = nav.map(n => `
    <button data-nav="${n.key}" class="${state.view === n.key || (n.key === 'projects' && ['project', 'project-board', 'project-rfis', 'project-documents', 'project-snags'].includes(state.view)) ? 'active' : ''}">
      ${NAV_ICONS[n.key] || ''}
      <span class="nav-label">${n.label}</span>
      ${n.key === 'my-tasks' && state.myOpenRfiCount > 0 ? `<span class="nav-badge" title="Open RFIs waiting on you">${state.myOpenRfiCount}</span>` : ''}
    </button>
  `).join('');

  return `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="sidebar-brand"><span class="brand-mark">CP</span>Civil <span>PM</span></div>
        <nav class="sidebar-nav">${navHtml}</nav>
        <div class="sidebar-footer">
          <div>
            <div class="sidebar-user-name">${escapeHtml(state.me.name)}</div>
            <div class="sidebar-user-badges">
              <span class="badge role-${escapeHtml(state.me.role)}">${escapeHtml(state.me.role)}</span>
              ${state.me.isAdmin ? '<span class="badge admin">Admin</span>' : ''}
            </div>
          </div>
          <button class="switch" id="switch-user">Log out</button>
        </div>
      </aside>
      <main id="main-content" class="main-content"><div class="main-content-inner"></div></main>
    </div>
  `;
}

function bindShell() {
  root.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', () => setView(el.dataset.nav));
  });
  root.querySelector('#switch-user').addEventListener('click', logout);

  const main = root.querySelector('.main-content-inner');
  if (state.view === 'dashboard') renderDashboard(main);
  else if (state.view === 'projects') renderProjects(main);
  else if (state.view === 'project') renderProjectDetail(main, state.activeProjectId);
  else if (state.view === 'project-board') renderProjectBoard(main, state.activeProjectId);
  else if (state.view === 'project-rfis') renderProjectRfis(main, state.activeProjectId);
  else if (state.view === 'project-documents') renderProjectDocuments(main, state.activeProjectId);
  else if (state.view === 'project-snags') renderProjectSnags(main, state.activeProjectId);
  else if (state.view === 'contacts') renderContacts(main);
  else if (state.view === 'external-contacts') renderExternalContacts(main);
  else if (state.view === 'team') renderTeam(main);
  else if (state.view === 'settings') renderSettings(main);
  else if (state.view === 'portfolio') renderPortfolio(main);
  else if (state.view === 'my-tasks') renderMyTasks(main);
  else if (state.view === 'offsite-reports') renderOffsiteReports(main);
}

// ---------------- CONTACTS ----------------

async function renderContacts(main) {
  main.innerHTML = `<h1>Contacts</h1><p class="subtitle">Loading…</p>`;
  let users;
  try {
    users = await api('/users');
  } catch (e) {
    main.innerHTML = `<h1>Contacts</h1><p class="error-text">${escapeHtml(e.message)}</p>`;
    return;
  }

  const rows = users.map(u => `
    <tr>
      <td>${escapeHtml(u.name)}</td>
      <td><span class="badge role-${escapeHtml(u.role)}">${escapeHtml(u.role)}</span></td>
      <td><a href="mailto:${encodeURIComponent(u.email)}">${escapeHtml(u.email)}</a></td>
      <td>${u.phone ? `<a href="tel:${encodeURIComponent(u.phone)}">${escapeHtml(u.phone)}</a>` : '<span class="hint">—</span>'}</td>
    </tr>
  `).join('');

  main.innerHTML = `
    <h1>Contacts</h1>
    <p class="subtitle">All team members. Tap an email or phone number to reach them directly.</p>
    <div class="card">
      <table>
        <thead><tr><th>Name</th><th>Role</th><th>Email</th><th>Phone</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// ---------------- EXTERNAL CONTACTS ----------------

async function renderExternalContacts(main) {
  main.innerHTML = `<h1>External Contacts</h1><p class="subtitle">Loading…</p>`;
  let contacts;
  try {
    contacts = await api('/external-contacts');
  } catch (e) {
    main.innerHTML = `<h1>External Contacts</h1><p class="error-text">${escapeHtml(e.message)}</p>`;
    return;
  }

  const rows = contacts.length === 0
    ? emptyStateRowHtml('No external contacts yet.', 6)
    : contacts.map(c => `
        <tr>
          <td>${escapeHtml(c.name)}</td>
          <td>${escapeHtml(c.company)}</td>
          <td><span class="badge badge-outline">${escapeHtml(c.category)}</span></td>
          <td>${c.project ? escapeHtml(c.project.name) : '<span class="hint">— (org-wide)</span>'}</td>
          <td><a href="mailto:${encodeURIComponent(c.email)}">${escapeHtml(c.email)}</a></td>
          <td>${c.phone ? `<a href="tel:${encodeURIComponent(c.phone)}">${escapeHtml(c.phone)}</a>` : '<span class="hint">—</span>'}</td>
        </tr>
      `).join('');

  main.innerHTML = `
    <h1>External Contacts</h1>
    <p class="subtitle">Subcontractors, consultants, and other stakeholders outside the internal team. Visible to admins and project managers.</p>
    <div class="card">
      <table>
        <thead><tr><th>Name</th><th>Company</th><th>Category</th><th>Project</th><th>Email</th><th>Phone</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// ---------------- DASHBOARD ----------------

// ---------------- DASHBOARD ANALYTICS (admins & project managers) ----------------

function projectStatusBarHtml(byStatus) {
  if (!byStatus.total) return emptyStateHtml('No projects to analyze yet.');
  const segments = [
    { count: byStatus.onTrack, label: 'On Track', color: 'var(--success)' },
    { count: byStatus.atRisk, label: 'At Risk', color: 'var(--warning)' },
    { count: byStatus.behind, label: 'Behind', color: 'var(--danger)' }
  ];
  return `
    <div class="analytics-status-bar">
      ${segments.map(s => s.count > 0 ? `<div style="width:${(s.count / byStatus.total) * 100}%; background:${s.color};" title="${s.label}: ${s.count}"></div>` : '').join('')}
    </div>
    <div class="analytics-legend">
      ${segments.map(s => `
        <div class="analytics-legend-item">
          <span class="analytics-legend-dot" style="background:${s.color};"></span>
          <span>${s.label}</span>
          <strong>${s.count}</strong>
        </div>
      `).join('')}
    </div>
  `;
}

function workloadListHtml(workload) {
  if (workload.length === 0) return emptyStateHtml('No team members yet.');
  const max = Math.max(1, ...workload.map(w => w.openTaskCount));
  return `
    <div class="workload-list">
      ${workload.map(w => `
        <div class="workload-row">
          <div class="workload-name">
            <span class="workload-name-text" title="${escapeHtml(w.name)}">${escapeHtml(w.name)}</span>
            <span class="badge role-${escapeHtml(w.role)}">${escapeHtml(w.role)}</span>
          </div>
          <div class="workload-bar-track"><div class="workload-bar-fill" style="width:${(w.openTaskCount / max) * 100}%;"></div></div>
          <div class="workload-count">${w.openTaskCount}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function rfiResponseTimeHtml(rt) {
  if (rt.averageDays == null) return emptyStateHtml('No answered RFIs yet.');

  let trendHtml = `<p class="hint">Not enough recent data to show a trend.</p>`;
  if (rt.trend) {
    if (rt.trend.direction === 'flat') {
      trendHtml = `<p class="hint">About the same as the previous 30 days.</p>`;
    } else {
      const isGood = rt.trend.direction === 'faster';
      const days = Math.abs(rt.trend.deltaDays).toFixed(1);
      trendHtml = `<p class="${isGood ? 'trend-good' : 'trend-bad'}">${isGood ? '&#9660;' : '&#9650;'} ${days} day${days === '1.0' ? '' : 's'} ${rt.trend.direction} than the previous 30 days</p>`;
    }
  }

  return `
    <div class="analytics-big-number">${rt.averageDays.toFixed(1)}<span class="analytics-big-number-unit">days</span></div>
    <p class="hint">Across ${rt.answeredCount} answered RFI${rt.answeredCount === 1 ? '' : 's'}.</p>
    ${trendHtml}
  `;
}

async function renderDashboard(main) {
  main.innerHTML = `<h1>Dashboard</h1><p class="subtitle">Loading…</p>`;
  let tasks, stats, analytics = null;
  try {
    tasks = await api('/dashboard');
    stats = await api('/dashboard-stats');
    if (state.me.isAdmin || state.me.isManager) {
      try {
        analytics = await api('/analytics');
      } catch (e) {
        analytics = null; // non-fatal — the rest of the dashboard still works without it
      }
    }
  } catch (e) {
    main.innerHTML = `<h1>Dashboard</h1><p class="error-text">${escapeHtml(e.message)}</p>`;
    return;
  }

  const statsHtml = stats.role === 'admin'
    ? `
      <div class="stat-grid">
        ${statCardHtml('folder', stats.activeProjects, 'Active Projects')}
        ${statCardHtml('tasks', stats.tasksAcrossTeam, 'Tasks Across Team')}
        ${statCardHtml('rfi', stats.openRfisOrgWide, 'Open RFIs (Org-wide)')}
        ${statCardHtml('team', stats.totalProjects, 'Total Projects')}
      </div>
    `
    : `
      <div class="stat-grid">
        ${statCardHtml('tasks', stats.myOpenTasks, 'My Open Tasks')}
        ${statCardHtml('rfi', stats.myOpenRfis, 'My Open RFIs')}
        ${statCardHtml('calendar', stats.dueSoonOrOverdue, 'Due This Week')}
      </div>
    `;

  const groupBy = state.dashboardGroupBy;
  const groups = new Map();
  tasks.forEach(t => {
    const key = groupBy === 'project'
      ? (t.project ? t.project.name : 'Unknown project')
      : (t.assignee ? t.assignee.name : 'Unassigned');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  });

  const projectLink = (project) => project
    ? `<a href="#" class="project-link" data-project-link="${project.id}">${escapeHtml(project.name)}</a>`
    : '—';

  const groupsHtml = tasks.length === 0
    ? emptyStateHtml('No tasks to show yet.')
    : Array.from(groups.entries()).map(([key, list]) => {
        const groupProject = groupBy === 'project' ? list[0].project : null;
        return `
          <div class="group-title">${groupProject ? projectLink(groupProject) : escapeHtml(key)}</div>
          <div class="card">
            <table>
              <thead><tr><th>Task</th><th>Project</th><th>Role</th><th>Assignee</th><th>Status</th></tr></thead>
              <tbody>
                ${list.map(t => `
                  <tr>
                    <td>${escapeHtml(t.title)}</td>
                    <td>${projectLink(t.project)}</td>
                    <td><span class="badge role-${escapeHtml(t.requiredRole)}">${escapeHtml(t.requiredRole)}</span></td>
                    <td>${t.assignee ? escapeHtml(t.assignee.name) : '<span class="hint">Unassigned</span>'}</td>
                    <td><span class="status ${escapeHtml(statusClass(t.status))}">${escapeHtml(t.status)}</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      }).join('');

  const analyticsHtml = analytics ? `
    <h2>Analytics</h2>
    <div class="analytics-grid">
      <div class="card">
        <h3>Projects by Status</h3>
        ${projectStatusBarHtml(analytics.projectsByStatus)}
      </div>
      <div class="card">
        <h3>Team Workload</h3>
        <p class="hint">Open tasks per person${analytics.scope === 'managed' ? ' (your projects)' : ''}.</p>
        ${workloadListHtml(analytics.workload)}
      </div>
      <div class="card">
        <h3>Average RFI Response Time</h3>
        ${rfiResponseTimeHtml(analytics.rfiResponseTime)}
      </div>
    </div>
  ` : '';

  main.innerHTML = `
    <h1>Dashboard</h1>
    <p class="subtitle">${state.me.isAdmin ? 'All projects and tasks across the org.' : 'Tasks assigned to you (and any projects you created).'}</p>
    ${statsHtml}
    ${analyticsHtml}
    <h2>Task Summary</h2>
    <div class="dash-toggle">
      <button class="btn ${groupBy === 'project' ? '' : 'secondary'}" data-group="project">Group by Project</button>
      <button class="btn ${groupBy === 'assignee' ? '' : 'secondary'}" data-group="assignee">Group by Assignee</button>
    </div>
    ${groupsHtml}
  `;

  main.querySelectorAll('[data-group]').forEach(el => {
    el.addEventListener('click', () => {
      state.dashboardGroupBy = el.dataset.group;
      renderDashboard(main);
    });
  });

  main.querySelectorAll('[data-project-link]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      setView('project', { projectId: Number(el.dataset.projectLink) });
    });
  });
}

// ---------------- MY TASKS ----------------

async function renderMyTasks(main) {
  if (state.myTasksUserId === null) state.myTasksUserId = state.me.id;
  if (!state.myTasksFilters) state.myTasksFilters = defaultTaskFilters();
  const filters = state.myTasksFilters;

  main.innerHTML = `<h1>My Tasks</h1><p class="subtitle">Loading…</p>`;
  let taskData, rfiData;
  try {
    const qs = taskQueryParams(filters, { assigneeId: state.myTasksUserId });
    taskData = await api('/tasks?' + qs);
    rfiData = await api('/my-rfis?userId=' + state.myTasksUserId);
  } catch (e) {
    main.innerHTML = `<h1>My Tasks</h1><p class="error-text">${escapeHtml(e.message)}</p>`;
    return;
  }

  const user = state.users.find(u => u.id === state.myTasksUserId) || state.me;
  const { tasks, total, page, totalPages } = taskData;
  const openRfis = rfiData.rfis;

  const rfiSectionHtml = `
    <div class="card">
      <h2>${state.me.isAdmin && user.id !== state.me.id ? `${escapeHtml(user.name)}'s` : 'My'} Open RFIs</h2>
      ${openRfis.length === 0
        ? emptyStateHtml('Nothing waiting — no open RFIs assigned.')
        : openRfis.map(r => `
            <div class="rfi-card">
              <div class="rfi-question">${escapeHtml(r.question)}</div>
              <div class="rfi-meta">
                <span>${escapeHtml(r.project ? r.project.name : 'Unknown project')}</span>
                <span>Due ${formatDate(r.dueDate)}</span>
                ${r.overdue ? '<span class="badge badge-overdue">Overdue</span>' : ''}
              </div>
            </div>
          `).join('')}
    </div>
  `;

  const pickerHtml = state.me.isAdmin
    ? `
      <div class="card">
        <label>View tasks for</label>
        <select id="my-tasks-user-picker">
          ${state.users.map(u => `<option value="${u.id}" ${u.id === state.myTasksUserId ? 'selected' : ''}>${escapeHtml(u.name)}${u.id === state.me.id ? ' (you)' : ''}</option>`).join('')}
        </select>
      </div>
    `
    : '';

  const tableHtml = tasks.length === 0
    ? emptyStateHtml(hasActiveTaskFilters(filters) ? 'No tasks match these filters.' : `${user.name} has no assigned tasks.`)
    : `
      <table>
        <thead><tr><th>Task</th><th>Project</th><th>Discipline</th><th>Status</th><th>Progress</th><th>Due</th></tr></thead>
        <tbody>
          ${tasks.map(t => `
            <tr class="task-row-clickable" data-open-task="${t.id}">
              <td><strong>${escapeHtml(t.title)}</strong></td>
              <td>${t.project ? escapeHtml(t.project.name) : '—'}</td>
              <td><span class="badge role-${escapeHtml(t.requiredRole)}">${escapeHtml(t.requiredRole)}</span></td>
              <td><span class="status ${escapeHtml(statusClass(t.status))}">${escapeHtml(t.status)}</span></td>
              <td>${taskProgressBarHtml(t, false, 'sm')}</td>
              <td>${formatDate(t.dueDate)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

  main.innerHTML = `
    <h1>My Tasks</h1>
    <p class="subtitle">${state.me.isAdmin ? `Tasks assigned to ${escapeHtml(user.name)}, across every project.` : 'Everything assigned to you, across every project.'}</p>
    ${pickerHtml}
    ${rfiSectionHtml}
    <div class="card">
      <h2>Tasks</h2>
      ${taskFilterBarHtml(filters, { showAssignee: false })}
      ${tableHtml}
      ${tasks.length > 0 ? paginationBarHtml(page, totalPages, total) : ''}
    </div>
    <div id="task-modal-root"></div>
  `;

  const picker = main.querySelector('#my-tasks-user-picker');
  if (picker) {
    picker.addEventListener('change', () => {
      state.myTasksUserId = Number(picker.value);
      state.myTasksFilters = defaultTaskFilters();
      renderMyTasks(main);
    });
  }

  bindTaskFilterBar(main, filters, () => renderMyTasks(main));
  bindPaginationBar(main, filters, () => renderMyTasks(main));

  main.querySelectorAll('[data-open-task]').forEach(row => {
    row.addEventListener('click', () => {
      const task = tasks.find(t => t.id === Number(row.dataset.openTask));
      if (task) showTaskModal(main, task, () => renderMyTasks(main));
    });
  });
}

// ---------------- PROJECTS ----------------

// Plain substring match on name/description — a project list is small
// enough (unlike tasks, which needed server-side search/pagination) that
// filtering the already-fetched list client-side on every keystroke is
// simple and instant, no debounce or round-trip needed.
function filterProjects(projects, search) {
  const needle = (search || '').trim().toLowerCase();
  if (!needle) return projects;
  return projects.filter(p =>
    p.name.toLowerCase().includes(needle) || (p.description || '').toLowerCase().includes(needle)
  );
}

function projectCardsHtml(projects) {
  return `<div class="grid">${projects.map(p => `
    <div class="card project-card" data-project="${p.id}">
      <h3>${escapeHtml(p.name)}</h3>
      <p>${escapeHtml(p.description || 'No description')}</p>
      <div class="meta">
        <span class="badge stage-${escapeHtml(p.stage)}">${escapeHtml(p.stage)}</span>
        <span>${p.taskCount} task${p.taskCount === 1 ? '' : 's'}</span>
        <span>${p.myTaskCount} assigned to you</span>
      </div>
    </div>
  `).join('')}</div>`;
}

async function renderProjects(main) {
  main.innerHTML = `<h1>Projects</h1><p class="subtitle">Loading…</p>`;
  let projects;
  try {
    projects = await api('/projects');
  } catch (e) {
    main.innerHTML = `<h1>Projects</h1><p class="error-text">${escapeHtml(e.message)}</p>`;
    return;
  }

  if (state.projectSearch === undefined) state.projectSearch = '';

  const stageOptions = state.stages.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');

  main.innerHTML = `
    <div class="section-header">
      <div>
        <h1>Projects</h1>
        <p class="subtitle">${state.me.isAdmin ? 'All projects.' : 'Projects you created or have tasks in.'}</p>
      </div>
    </div>
    ${state.me.isAdmin ? `
    <div class="card">
      <h2>New Project</h2>
      <form id="new-project-form">
        <div><label>Name</label><input name="name" required placeholder="e.g. Riverside Bridge Rehabilitation" /></div>
        <div><label>Description</label><textarea name="description" placeholder="Short description of the project"></textarea></div>
        <div class="form-row">
          <div><label>Start Date</label><input name="startDate" type="date" /></div>
          <div><label>End Date</label><input name="endDate" type="date" /></div>
          <div><label>Stage</label><select name="stage">${stageOptions}</select></div>
        </div>
        <div class="hint">Dates default to today / +90 days if left blank.</div>
        <div id="project-form-error" class="error-text"></div>
        <button class="btn" type="submit">Create Project</button>
      </form>
    </div>
    ` : ''}
    ${projects.length > 0 ? `
    <div class="task-filter-bar">
      <input type="search" class="task-filter-search" id="project-search-input" placeholder="Search projects…" value="${escapeHtml(state.projectSearch)}" />
    </div>
    ` : ''}
    <div id="project-cards-root"></div>
  `;

  const cardsRoot = main.querySelector('#project-cards-root');
  function renderCards() {
    const filtered = filterProjects(projects, state.projectSearch);
    cardsRoot.innerHTML = filtered.length === 0
      ? emptyStateHtml(projects.length === 0 ? 'No projects visible to you yet.' : 'No projects match your search.')
      : projectCardsHtml(filtered);
    cardsRoot.querySelectorAll('[data-project]').forEach(el => {
      el.addEventListener('click', () => setView('project', { projectId: Number(el.dataset.project) }));
    });
  }
  renderCards();

  const searchInput = main.querySelector('#project-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      state.projectSearch = searchInput.value;
      renderCards();
    });
  }

  const newProjectForm = main.querySelector('#new-project-form');
  if (newProjectForm) {
    newProjectForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const errBox = form.querySelector('#project-form-error');
      errBox.textContent = '';
      try {
        await api('/projects', {
          method: 'POST',
          body: JSON.stringify({
            name: form.name.value,
            description: form.description.value,
            startDate: form.startDate.value || undefined,
            endDate: form.endDate.value || undefined,
            stage: form.stage.value
          })
        });
        renderProjects(main);
      } catch (err) {
        errBox.textContent = err.message;
      }
    });
  }
}

// ---------------- PROJECT TABS (shared by List / Board / RFIs) ----------------

function projectTabsHtml(active) {
  const tabs = [
    { key: 'project', label: 'List View' },
    { key: 'project-board', label: 'Board View' },
    { key: 'project-rfis', label: 'RFIs' },
    { key: 'project-documents', label: 'Documents' },
    { key: 'project-snags', label: 'Snags' }
  ];
  return `<div class="dash-toggle">${tabs.map(t => `
    <button class="btn ${t.key === active ? '' : 'secondary'}" data-project-tab="${t.key}">${t.label}</button>
  `).join('')}</div>`;
}

function bindProjectTabs(main, projectId) {
  main.querySelectorAll('[data-project-tab]').forEach(el => {
    el.addEventListener('click', () => setView(el.dataset.projectTab, { projectId }));
  });
}

// ---------------- PROJECT DETAIL ----------------

async function renderProjectDetail(main, projectId) {
  if (!state.projectListFilters || state.projectListFilters.projectId !== projectId) {
    state.projectListFilters = Object.assign(defaultTaskFilters(), { projectId });
  }
  const filters = state.projectListFilters;

  main.innerHTML = `<p class="subtitle">Loading…</p>`;
  let project, taskData, fieldReports;
  try {
    project = await api('/projects/' + projectId);
    const qs = taskQueryParams(filters, { projectId });
    taskData = await api('/tasks?' + qs);
    fieldReports = await api('/projects/' + projectId + '/reports');
  } catch (e) {
    main.innerHTML = `<button class="back-link" id="back-to-projects">&larr; Back to Projects</button><p class="error-text">${escapeHtml(e.message)}</p>`;
    main.querySelector('#back-to-projects').addEventListener('click', () => setView('projects'));
    return;
  }

  const { tasks, total, page, totalPages } = taskData;
  const isManager = state.me.isAdmin || project.createdBy === state.me.id;

  const roleOptions = state.roles.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('');

  function assigneeOptionsForRole(role, selectedId, restrictToSelf) {
    const sel = (id) => (selectedId != null && Number(selectedId) === id) ? ' selected' : '';
    let html = `<option value=""${selectedId == null ? ' selected' : ''}>— Unassigned —</option>`;
    if (restrictToSelf) {
      html += `<option value="${state.me.id}"${sel(state.me.id)}>${escapeHtml(state.me.name)} (you)</option>`;
      return html;
    }
    const matching = state.users.filter(u => u.role === role);
    const others = state.users.filter(u => u.role !== role);
    if (matching.length) {
      html += `<optgroup label="Suggested (${role})">` +
        matching.map(u => `<option value="${u.id}"${sel(u.id)}>${escapeHtml(u.name)}</option>`).join('') +
        `</optgroup>`;
    }
    if (others.length) {
      html += `<optgroup label="Other team members">` +
        others.map(u => `<option value="${u.id}"${sel(u.id)}>${escapeHtml(u.name)} (${escapeHtml(u.role)})</option>`).join('') +
        `</optgroup>`;
    }
    return html;
  }

  const summaryHtml = `
    <div class="card">
      <h2>Weekly Summary</h2>
      ${project.summary
        ? `
          <p class="hint">Generated ${formatDate(project.summary.generatedAt.slice(0, 10))}</p>
          <div class="summary-text">${project.summary.text.split(/\n+/).filter(p => p.trim()).map(p => `<p>${escapeHtml(p.trim())}</p>`).join('')}</div>
        `
        : emptyStateHtml('No weekly summary yet — one is generated automatically, usually within the first week.')}
    </div>
  `;

  const taskRows = tasks.length === 0
    ? emptyStateRowHtml(hasActiveTaskFilters(filters) ? 'No tasks match these filters.' : 'No tasks yet.', 6)
    : tasks.map(t => {
        const canChangeStatus = isManager || t.assigneeId === state.me.id;
        return `
          <tr data-task="${t.id}" class="task-row-clickable" data-open-task="${t.id}">
            <td>
              <strong>${escapeHtml(t.title)}</strong>
              ${t.description ? `<div class="hint">${escapeHtml(t.description)}</div>` : ''}
            </td>
            <td><span class="badge role-${escapeHtml(t.requiredRole)}">${escapeHtml(t.requiredRole)}</span></td>
            <td>
              <select class="select-inline" data-action="reassign" data-task="${t.id}">${assigneeOptionsForRole(t.requiredRole, t.assigneeId, !isManager)}</select>
            </td>
            <td>
              ${canChangeStatus
                ? `<select class="select-inline" data-action="status" data-task="${t.id}">
                    ${state.taskStatuses.map(s => `<option value="${escapeHtml(s)}" ${s === t.status ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
                  </select>`
                : `<span class="status ${escapeHtml(statusClass(t.status))}">${escapeHtml(t.status)}</span>`}
            </td>
            <td>${taskProgressBarHtml(t, false, 'sm')}</td>
            <td>${formatDate(t.dueDate)}</td>
          </tr>
        `;
      }).join('');

  main.innerHTML = `
    <button class="back-link" id="back-to-projects">&larr; Back to Projects</button>
    <h1>${escapeHtml(project.name)}</h1>
    <p class="subtitle">${escapeHtml(project.description || '')}</p>
    <div class="gantt-progress-track" style="max-width:260px;"><div class="gantt-progress-fill" style="width:${project.progress || 0}%; background:${project.color || '#1e3a5f'};"></div></div>
    <p class="hint">${project.progress || 0}% complete${project.progressMode === 'manual' ? ' (manual override)' : ` (auto — average across ${project.taskProgress ? project.taskProgress.total : 0} task${project.taskProgress && project.taskProgress.total === 1 ? '' : 's'})`}</p>
    ${project.location ? `<p class="hint">${escapeHtml(project.location)}</p><div id="project-weather"></div>` : ''}
    ${projectTabsHtml('project')}

    ${summaryHtml}

    <div class="card">
      <div class="section-header">
        <h2>Tasks</h2>
        ${isManager ? `<button type="button" class="btn small secondary" id="import-tasks-btn">Import Tasks</button>` : ''}
      </div>
      ${taskFilterBarHtml(filters, { lockedProjectId: projectId })}
      <table>
        <thead><tr><th>Task</th><th>Role</th><th>Assignee</th><th>Status</th><th>Progress</th><th>Due</th></tr></thead>
        <tbody>${taskRows}</tbody>
      </table>
      ${tasks.length > 0 ? paginationBarHtml(page, totalPages, total) : ''}
    </div>

    ${isManager ? `
    <div class="card">
      <h2>New Task</h2>
      <form id="new-task-form">
        <div><label>Title</label><input name="title" required placeholder="e.g. Foundation load calculation" /></div>
        <div><label>Description</label><textarea name="description" placeholder="Optional details"></textarea></div>
        <div class="form-row">
          <div>
            <label>Required Role</label>
            <select name="requiredRole" id="required-role-select">${roleOptions}</select>
          </div>
          <div>
            <label>Assign to</label>
            <select name="assigneeId" id="assignee-select">${assigneeOptionsForRole(state.roles[0], null, false)}</select>
            <div class="hint">Suggestions are matched to the required role above.</div>
          </div>
          <div>
            <label>Due date</label>
            <input name="dueDate" type="date" />
          </div>
        </div>
        <div id="task-form-error" class="error-text"></div>
        <button class="btn" type="submit">Create Task</button>
      </form>
    </div>
    ` : ''}

    <div class="card">
      <h2>Field Reports</h2>
      ${fieldReports.length === 0
        ? emptyStateHtml('No approved offsite reports for this project yet.')
        : `<table>
            <thead><tr><th>Date</th><th>Submitted By</th><th>Photos</th><th></th></tr></thead>
            <tbody>
              ${fieldReports.map(r => `
                <tr>
                  <td>${formatDate(r.createdAt.slice(0, 10))}</td>
                  <td>${escapeHtml(r.submitter ? r.submitter.name : '—')}</td>
                  <td>${r.photoUrls.length}</td>
                  <td><button class="btn small secondary" data-view-report="${r.id}">View</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>`}
    </div>
    <div id="report-modal-root"></div>
    <div id="task-modal-root"></div>
    <div id="import-modal-root"></div>
  `;

  main.querySelector('#back-to-projects').addEventListener('click', () => setView('projects'));
  bindProjectTabs(main, projectId);
  bindTaskFilterBar(main, filters, () => renderProjectDetail(main, projectId), { lockedProjectId: projectId });
  bindPaginationBar(main, filters, () => renderProjectDetail(main, projectId));
  if (project.location) loadWeatherInto(main.querySelector('#project-weather'), projectId, {});

  main.querySelectorAll('[data-view-report]').forEach(el => {
    el.addEventListener('click', () => showReportModal(main, Number(el.dataset.viewReport), false));
  });

  const importBtn = main.querySelector('#import-tasks-btn');
  if (importBtn) {
    importBtn.addEventListener('click', () => showImportTasksModal(main, projectId, () => renderProjectDetail(main, projectId)));
  }

  const roleSelect = main.querySelector('#required-role-select');
  const assigneeSelect = main.querySelector('#assignee-select');
  if (roleSelect && assigneeSelect) {
    roleSelect.addEventListener('change', () => {
      assigneeSelect.innerHTML = assigneeOptionsForRole(roleSelect.value, null, false);
    });
  }

  main.querySelectorAll('[data-action="reassign"]').forEach(el => {
    el.addEventListener('click', (e) => e.stopPropagation());
    el.addEventListener('change', async () => {
      try {
        await api('/tasks/' + el.dataset.task, {
          method: 'PATCH',
          body: JSON.stringify({ assigneeId: el.value ? Number(el.value) : null })
        });
        renderProjectDetail(main, projectId);
      } catch (err) {
        alert(err.message);
        renderProjectDetail(main, projectId);
      }
    });
  });

  main.querySelectorAll('[data-action="status"]').forEach(el => {
    el.addEventListener('click', (e) => e.stopPropagation());
    el.addEventListener('change', async () => {
      try {
        await api('/tasks/' + el.dataset.task, {
          method: 'PATCH',
          body: JSON.stringify({ status: el.value })
        });
        renderProjectDetail(main, projectId);
      } catch (err) {
        alert(err.message);
        renderProjectDetail(main, projectId);
      }
    });
  });

  main.querySelectorAll('[data-open-task]').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('select, button, a, input')) return;
      const task = tasks.find(t => t.id === Number(row.dataset.openTask));
      if (task) showTaskModal(main, task, () => renderProjectDetail(main, projectId));
    });
  });

  const newTaskForm = main.querySelector('#new-task-form');
  if (newTaskForm) {
    newTaskForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const errBox = form.querySelector('#task-form-error');
      errBox.textContent = '';
      try {
        await api('/projects/' + projectId + '/tasks', {
          method: 'POST',
          body: JSON.stringify({
            title: form.title.value,
            description: form.description.value,
            requiredRole: form.requiredRole.value,
            assigneeId: form.assigneeId.value || null,
            dueDate: form.dueDate.value || null
          })
        });
        renderProjectDetail(main, projectId);
      } catch (err) {
        errBox.textContent = err.message;
      }
    });
  }
}

// ---------------- IMPORT TASKS (CSV / Excel) ----------------
// Two-step: pick a file -> see a row-by-row preview (with any problems
// flagged inline) -> confirm to actually create the valid tasks. Nothing is
// created until the user explicitly confirms the preview.

function showImportTasksModal(main, projectId, onImported) {
  const modalRoot = main.querySelector('#import-modal-root');
  if (!modalRoot) return;

  const close = () => { modalRoot.innerHTML = ''; };

  function renderShell(innerHtml) {
    modalRoot.innerHTML = `
      <div class="modal-overlay" id="import-modal-overlay">
        <div class="modal-card modal-card-wide">
          <button class="modal-close" id="import-modal-close">&times;</button>
          <h2>Import Tasks</h2>
          ${innerHtml}
        </div>
      </div>
    `;
    document.getElementById('import-modal-close').addEventListener('click', close);
    document.getElementById('import-modal-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'import-modal-overlay') close();
    });
  }

  function renderPicker(errorMessage) {
    renderShell(`
      <p class="subtitle">Upload a CSV or Excel (.xlsx) file with columns for Title, Description, Assignee (email or name), Discipline/Role, Status, and Due Date. You'll see a preview before anything is created.</p>
      <input type="file" id="import-file-input" accept=".csv,.xlsx" />
      ${errorMessage ? `<p class="error-text">${escapeHtml(errorMessage)}</p>` : ''}
    `);
    document.getElementById('import-file-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      renderShell(`<p class="subtitle">Reading ${escapeHtml(file.name)}…</p>`);
      try {
        const formData = new FormData();
        formData.append('file', file);
        const result = await apiUpload('/projects/' + projectId + '/tasks/import/preview', formData);
        renderPreview(result);
      } catch (err) {
        renderPicker(err.message);
      }
    });
  }

  function renderPreview(result) {
    const { rows, validCount, errorCount } = result;
    renderShell(`
      <p class="subtitle">${validCount} task${validCount === 1 ? '' : 's'} ready to import${errorCount ? `, ${errorCount} row${errorCount === 1 ? '' : 's'} will be skipped (see below)` : ''}.</p>
      <div class="import-preview-scroll">
        <table>
          <thead><tr><th>Row</th><th>Title</th><th>Discipline</th><th>Status</th><th>Assignee</th><th>Due</th><th>Issue</th></tr></thead>
          <tbody>
            ${rows.map(r => `
              <tr class="${r.errors.length ? 'import-row-error' : ''}">
                <td>${r.rowNumber}</td>
                <td>${escapeHtml(r.title || '(blank)')}</td>
                <td>${escapeHtml(r.requiredRole || '—')}</td>
                <td>${escapeHtml(r.status || '—')}</td>
                <td>${escapeHtml(r.assigneeName || r.assigneeRaw || '—')}</td>
                <td>${r.dueDate ? formatDate(r.dueDate) : '—'}</td>
                <td class="import-row-issue">${r.errors.length ? escapeHtml(r.errors.join('; ')) : ''}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div id="import-confirm-error" class="error-text"></div>
      <div class="modal-actions">
        <button type="button" class="btn secondary" id="import-choose-different">Choose a different file</button>
        <button type="button" class="btn" id="import-confirm-btn" ${validCount === 0 ? 'disabled' : ''}>Import ${validCount} task${validCount === 1 ? '' : 's'}</button>
      </div>
    `);
    document.getElementById('import-choose-different').addEventListener('click', () => renderPicker());
    const confirmBtn = document.getElementById('import-confirm-btn');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', async () => {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Importing…';
        const errBox = document.getElementById('import-confirm-error');
        try {
          const validRows = rows.filter(r => r.errors.length === 0);
          const confirmResult = await api('/projects/' + projectId + '/tasks/import/confirm', {
            method: 'POST',
            body: JSON.stringify({ rows: validRows })
          });
          close();
          if (onImported) onImported();
          alert(`Imported ${confirmResult.createdCount} task${confirmResult.createdCount === 1 ? '' : 's'}.`);
        } catch (err) {
          errBox.textContent = err.message;
          confirmBtn.disabled = false;
          confirmBtn.textContent = `Import ${validCount} task${validCount === 1 ? '' : 's'}`;
        }
      });
    }
  }

  renderPicker();
}

// ---------------- PROJECT BOARD (KANBAN) ----------------

async function renderProjectBoard(main, projectId) {
  if (!state.boardFilters || state.boardFilters.projectId !== projectId) {
    state.boardFilters = Object.assign(defaultTaskFilters(), { projectId, pageSize: 150 });
  }
  const filters = state.boardFilters;

  main.innerHTML = `<p class="subtitle">Loading…</p>`;
  let project, taskData;
  try {
    project = await api('/projects/' + projectId);
    const qs = taskQueryParams(filters, { projectId });
    taskData = await api('/tasks?' + qs);
  } catch (e) {
    main.innerHTML = `<button class="back-link" id="back-to-projects">&larr; Back to Projects</button><p class="error-text">${escapeHtml(e.message)}</p>`;
    main.querySelector('#back-to-projects').addEventListener('click', () => setView('projects'));
    return;
  }

  const { tasks, total, page, totalPages } = taskData;
  const isManager = state.me.isAdmin || project.createdBy === state.me.id;

  const columnsHtml = state.taskStatuses.map(status => {
    const columnTasks = tasks.filter(t => t.status === status);
    const cardsHtml = columnTasks.map(t => {
      const canDrag = isManager || t.assigneeId === state.me.id;
      const canEditProgress = canDrag; // same rule: assignee or this project's manager
      return `
        <div class="board-card" data-task-card="${t.id}" ${canDrag ? 'draggable="true"' : ''}>
          <div class="board-card-title">${escapeHtml(t.title)}</div>
          <div class="board-card-meta">
            <span class="badge role-${escapeHtml(t.requiredRole)}">${escapeHtml(t.requiredRole)}</span>
            <span>${t.assignee ? escapeHtml(t.assignee.name) : 'Unassigned'}</span>
            ${t.dueDate ? `<span>Due ${formatDate(t.dueDate)}</span>` : ''}
          </div>
          ${taskProgressBarHtml(t, canEditProgress, 'sm')}
        </div>
      `;
    }).join('');

    return `
      <div class="board-column" data-status-column="${escapeHtml(status)}">
        <div class="board-column-header">
          <span>${escapeHtml(status)}</span>
          <span class="board-column-count">${columnTasks.length}</span>
        </div>
        <div class="board-column-body" data-drop-status="${escapeHtml(status)}">${cardsHtml}</div>
      </div>
    `;
  }).join('');

  main.innerHTML = `
    <button class="back-link" id="back-to-projects">&larr; Back to Projects</button>
    <h1>${escapeHtml(project.name)}</h1>
    <p class="subtitle">Board view. Drag a card between columns to update its status, or click a card for details.</p>
    ${projectTabsHtml('project-board')}
    ${taskFilterBarHtml(filters, { lockedProjectId: projectId })}
    <div class="board">${columnsHtml}</div>
    ${tasks.length > 0 ? paginationBarHtml(page, totalPages, total, { loadMore: true, loadedCount: tasks.length }) : ''}
    <div id="task-modal-root"></div>
  `;

  main.querySelector('#back-to-projects').addEventListener('click', () => setView('projects'));
  bindProjectTabs(main, projectId);
  bindTaskFilterBar(main, filters, () => renderProjectBoard(main, projectId), { lockedProjectId: projectId });
  bindPaginationBar(main, filters, () => renderProjectBoard(main, projectId), { loadMore: true, pageSize: 150 });

  main.querySelectorAll('[data-task-card]').forEach(card => {
    const taskId = Number(card.dataset.taskCard);

    card.addEventListener('click', () => {
      const task = tasks.find(t => t.id === taskId);
      if (task) showTaskModal(main, task, () => renderProjectBoard(main, projectId));
    });

    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', String(taskId));
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
  });

  main.querySelectorAll('[data-drop-status]').forEach(column => {
    column.addEventListener('dragover', (e) => {
      e.preventDefault();
      column.classList.add('drag-over');
    });
    column.addEventListener('dragleave', () => column.classList.remove('drag-over'));
    column.addEventListener('drop', async (e) => {
      e.preventDefault();
      column.classList.remove('drag-over');
      const taskId = Number(e.dataTransfer.getData('text/plain'));
      const newStatus = column.dataset.dropStatus;
      try {
        await api('/tasks/' + taskId, { method: 'PATCH', body: JSON.stringify({ status: newStatus }) });
        renderProjectBoard(main, projectId);
      } catch (err) {
        alert(err.message);
        renderProjectBoard(main, projectId);
      }
    });
  });

  bindTaskProgressBars(main, () => renderProjectBoard(main, projectId));
}

// Opens the shared task-detail modal for any task list this app has (Task
// Board, My Tasks, Project List View...). `task` must already carry its
// enriched `.project` (as every /api/tasks and /api/projects/:id/tasks
// response does), so no extra fetch is needed just to open it — clicking any
// task, from any view, goes straight to its details. `onUpdated()` is called
// after any change so the calling view can refresh itself.
function showTaskModal(main, task, onUpdated) {
  const modalRoot = main.querySelector('#task-modal-root');
  if (!modalRoot || !task) return;

  const project = task.project;
  const taskId = task.id;
  const isManager = state.me.isAdmin || (project && project.createdBy === state.me.id);
  const canChangeStatus = isManager || task.assigneeId === state.me.id;

  function assigneeOptionsForRole(role, selectedId, restrictToSelf) {
    const sel = (id) => (selectedId != null && Number(selectedId) === id) ? ' selected' : '';
    let html = `<option value=""${selectedId == null ? ' selected' : ''}>— Unassigned —</option>`;
    if (restrictToSelf) {
      html += `<option value="${state.me.id}"${sel(state.me.id)}>${escapeHtml(state.me.name)} (you)</option>`;
      return html;
    }
    const matching = state.users.filter(u => u.role === role);
    const others = state.users.filter(u => u.role !== role);
    if (matching.length) {
      html += `<optgroup label="Suggested (${role})">` +
        matching.map(u => `<option value="${u.id}"${sel(u.id)}>${escapeHtml(u.name)}</option>`).join('') +
        `</optgroup>`;
    }
    if (others.length) {
      html += `<optgroup label="Other team members">` +
        others.map(u => `<option value="${u.id}"${sel(u.id)}>${escapeHtml(u.name)} (${escapeHtml(u.role)})</option>`).join('') +
        `</optgroup>`;
    }
    return html;
  }

  modalRoot.innerHTML = `
    <div class="modal-overlay" id="task-modal-overlay">
      <div class="modal-card">
        <button class="modal-close" id="task-modal-close">&times;</button>
        <h2>${escapeHtml(task.title)}</h2>
        ${project ? `<p class="hint">${escapeHtml(project.name)}</p>` : ''}
        <span class="badge role-${escapeHtml(task.requiredRole)}">${escapeHtml(task.requiredRole)}</span>
        <p class="subtitle">${escapeHtml(task.description || 'No description')}</p>
        <div class="form-row">
          <div>
            <label>Assignee</label>
            <select class="select-inline" id="task-modal-assignee">${assigneeOptionsForRole(task.requiredRole, task.assigneeId, !isManager)}</select>
          </div>
          <div>
            <label>Status</label>
            ${canChangeStatus
              ? `<select class="select-inline" id="task-modal-status">${state.taskStatuses.map(s => `<option value="${escapeHtml(s)}" ${s === task.status ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}</select>`
              : `<div><span class="status ${escapeHtml(statusClass(task.status))}">${escapeHtml(task.status)}</span></div>`}
          </div>
          <div>
            <label>Due date</label>
            ${isManager
              ? `<input class="select-inline" type="date" id="task-modal-due-date" value="${task.dueDate || ''}" />`
              : `<div>${formatDate(task.dueDate)}</div>`}
          </div>
        </div>
        <div>
          <label>Progress</label>
          ${taskProgressBarHtml(task, canChangeStatus, 'lg')}
        </div>
        <div id="task-modal-error" class="error-text"></div>
      </div>
    </div>
  `;

  const overlay = document.getElementById('task-modal-overlay');
  const close = () => { modalRoot.innerHTML = ''; };
  document.getElementById('task-modal-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const refresh = () => { close(); if (onUpdated) onUpdated(taskId); };

  const errBox = document.getElementById('task-modal-error');
  const assigneeSelect = document.getElementById('task-modal-assignee');
  if (assigneeSelect) {
    assigneeSelect.addEventListener('change', async () => {
      try {
        await api('/tasks/' + taskId, {
          method: 'PATCH',
          body: JSON.stringify({ assigneeId: assigneeSelect.value ? Number(assigneeSelect.value) : null })
        });
        refresh();
      } catch (err) {
        errBox.textContent = err.message;
      }
    });
  }
  const statusSelect = document.getElementById('task-modal-status');
  if (statusSelect) {
    statusSelect.addEventListener('change', async () => {
      try {
        await api('/tasks/' + taskId, { method: 'PATCH', body: JSON.stringify({ status: statusSelect.value }) });
        refresh();
      } catch (err) {
        errBox.textContent = err.message;
      }
    });
  }
  const dueDateInput = document.getElementById('task-modal-due-date');
  if (dueDateInput) {
    dueDateInput.addEventListener('change', async () => {
      try {
        await api('/tasks/' + taskId, { method: 'PATCH', body: JSON.stringify({ dueDate: dueDateInput.value || null }) });
        refresh();
      } catch (err) {
        errBox.textContent = err.message;
      }
    });
  }
  bindTaskProgressBars(modalRoot, refresh);
}

// ---------------- PROJECT RFIs ----------------

async function renderProjectRfis(main, projectId) {
  main.innerHTML = `<p class="subtitle">Loading…</p>`;
  let project, rfis;
  try {
    project = await api('/projects/' + projectId);
    rfis = await api('/projects/' + projectId + '/rfis');
  } catch (e) {
    main.innerHTML = `<button class="back-link" id="back-to-projects">&larr; Back to Projects</button><p class="error-text">${escapeHtml(e.message)}</p>`;
    main.querySelector('#back-to-projects').addEventListener('click', () => setView('projects'));
    return;
  }

  const isManager = state.me.isAdmin || project.createdBy === state.me.id;
  const userOptions = state.users.map(u => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join('');

  const rfiCardsHtml = rfis.length === 0
    ? emptyStateHtml('No RFIs for this project yet.')
    : rfis.map(r => {
        const canAnswer = r.status === 'Open' && (isManager || r.assignedTo === state.me.id);
        const answerBlockHtml = r.status === 'Answered'
          ? `<div class="rfi-answer"><div class="rfi-answer-label">Answer</div>${escapeHtml(r.answer)}</div>`
          : canAnswer
            ? `<form class="rfi-answer-form" data-answer-form="${r.id}">
                 <textarea placeholder="Type an answer…" required></textarea>
                 <button class="btn small" type="submit">Submit Answer</button>
                 <div class="error-text" data-answer-error="${r.id}"></div>
               </form>`
            : `<p class="hint">Awaiting answer from ${escapeHtml(r.assignee ? r.assignee.name : 'assignee')}.</p>`;

        return `
          <div class="card rfi-card">
            <div class="rfi-question">${escapeHtml(r.question)}</div>
            <div class="rfi-meta">
              <span>Assigned to <strong>${escapeHtml(r.assignee ? r.assignee.name : 'Unknown')}</strong></span>
              <span>Due ${formatDate(r.dueDate)}</span>
              <span class="status ${escapeHtml(statusClass(r.status))}">${escapeHtml(r.status)}</span>
              ${r.overdue ? '<span class="badge badge-overdue">Overdue</span>' : ''}
            </div>
            ${answerBlockHtml}
          </div>
        `;
      }).join('');

  main.innerHTML = `
    <button class="back-link" id="back-to-projects">&larr; Back to Projects</button>
    <h1>${escapeHtml(project.name)}</h1>
    <p class="subtitle">Requests for Information — ask a question, assign it to a team member, and track the answer.</p>
    ${projectTabsHtml('project-rfis')}

    <div class="card">
      <h2>New RFI</h2>
      <form id="new-rfi-form">
        <div><label>Question</label><textarea name="question" required placeholder="What do you need clarified?"></textarea></div>
        <div class="form-row">
          <div><label>Assign to</label><select name="assignedTo" required>${userOptions}</select></div>
          <div><label>Due Date</label><input name="dueDate" type="date" required /></div>
        </div>
        <div id="rfi-form-error" class="error-text"></div>
        <button class="btn" type="submit">Create RFI</button>
      </form>
    </div>

    <div class="card">
      <h2>RFIs</h2>
      ${rfiCardsHtml}
    </div>
  `;

  main.querySelector('#back-to-projects').addEventListener('click', () => setView('projects'));
  bindProjectTabs(main, projectId);

  main.querySelector('#new-rfi-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const errBox = form.querySelector('#rfi-form-error');
    errBox.textContent = '';
    try {
      await api('/projects/' + projectId + '/rfis', {
        method: 'POST',
        body: JSON.stringify({
          question: form.question.value,
          assignedTo: form.assignedTo.value,
          dueDate: form.dueDate.value
        })
      });
      await refreshMyOpenRfiCount();
      render();
    } catch (err) {
      errBox.textContent = err.message;
    }
  });

  main.querySelectorAll('[data-answer-form]').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const rfiId = Number(form.dataset.answerForm);
      const errBox = main.querySelector(`[data-answer-error="${rfiId}"]`);
      errBox.textContent = '';
      try {
        await api('/rfis/' + rfiId, {
          method: 'PATCH',
          body: JSON.stringify({ answer: form.querySelector('textarea').value })
        });
        await refreshMyOpenRfiCount();
        render();
      } catch (err) {
        errBox.textContent = err.message;
      }
    });
  });
}

// ---------------- PROJECT DOCUMENTS (register) ----------------

async function renderProjectDocuments(main, projectId) {
  main.innerHTML = `<p class="subtitle">Loading…</p>`;
  let project, documents;
  try {
    project = await api('/projects/' + projectId);
    documents = await api('/projects/' + projectId + '/documents');
  } catch (e) {
    main.innerHTML = `<button class="back-link" id="back-to-projects">&larr; Back to Projects</button><p class="error-text">${escapeHtml(e.message)}</p>`;
    main.querySelector('#back-to-projects').addEventListener('click', () => setView('projects'));
    return;
  }

  const isManager = state.me.isAdmin || project.createdBy === state.me.id;

  const rowsHtml = documents.length === 0
    ? emptyStateRowHtml('No documents uploaded yet.', 6)
    : documents.map(d => `
        <tr class="task-row-clickable" data-open-doc="${d.id}">
          <td>
            <strong>${escapeHtml(d.docNumber)}</strong>
            ${d.description ? `<div class="hint">${escapeHtml(d.description)}</div>` : ''}
          </td>
          <td>${escapeHtml(d.version)}</td>
          <td>
            <span class="badge badge-current">Current</span>
            ${d.versionCount > 1 ? `<div class="hint">${d.versionCount} versions</div>` : ''}
          </td>
          <td>${d.uploader ? escapeHtml(d.uploader.name) : '—'}</td>
          <td>${formatDate(d.uploadedAt.slice(0, 10))}</td>
          <td><a href="#" data-download-doc data-file-url="${escapeHtml(d.fileUrl)}" data-file-name="${escapeHtml(d.originalFileName)}">Download</a></td>
        </tr>
      `).join('');

  main.innerHTML = `
    <button class="back-link" id="back-to-projects">&larr; Back to Projects</button>
    <h1>${escapeHtml(project.name)}</h1>
    <p class="subtitle">Document register — current drawing/spec versions for this project. Click a document to see its version history.</p>
    ${projectTabsHtml('project-documents')}

    ${isManager ? `
    <div class="card">
      <h2>Upload Document</h2>
      <form id="document-upload-form">
        <div class="form-row">
          <div><label>Document Name/Number</label><input name="docNumber" required placeholder="e.g. Foundation Plan - Block C" /></div>
          <div><label>Version</label><input name="version" required placeholder="e.g. Rev 3" /></div>
        </div>
        <div><label>Description (optional)</label><input name="description" placeholder="What changed in this version" /></div>
        <div><label>File</label><input name="file" type="file" required /></div>
        <div class="hint">If this name/number matches an existing document, this upload becomes its new current version — the previous one is kept, marked "Superseded".</div>
        <div id="document-form-error" class="error-text"></div>
        <button class="btn" type="submit">Upload</button>
      </form>
    </div>
    ` : ''}

    <div class="card">
      <h2>Documents</h2>
      <table>
        <thead><tr><th>Document</th><th>Current Version</th><th>Status</th><th>Uploaded By</th><th>Uploaded</th><th></th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    <div id="document-modal-root"></div>
  `;

  main.querySelector('#back-to-projects').addEventListener('click', () => setView('projects'));
  bindProjectTabs(main, projectId);

  bindDocumentDownloadLinks(main);

  main.querySelectorAll('[data-open-doc]').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('a, button, input')) return;
      showDocumentHistoryModal(main, Number(row.dataset.openDoc));
    });
  });

  const form = main.querySelector('#document-upload-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errBox = form.querySelector('#document-form-error');
      errBox.textContent = '';
      const fileInput = form.querySelector('input[type="file"]');
      if (!fileInput.files[0]) {
        errBox.textContent = 'Please choose a file to upload.';
        return;
      }
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      try {
        const formData = new FormData();
        formData.append('docNumber', form.docNumber.value);
        formData.append('version', form.version.value);
        formData.append('description', form.description.value);
        formData.append('file', fileInput.files[0]);
        await apiUpload('/projects/' + projectId + '/documents', formData);
        renderProjectDocuments(main, projectId);
      } catch (err) {
        submitBtn.disabled = false;
        errBox.textContent = err.message;
      }
    });
  }
}

// Document files sit behind the same gate+session auth as everything else
// under /uploads, so a plain <a href> can't fetch them directly (it can't
// attach the custom auth headers) — same blob-URL-download workaround used
// for photos/audio elsewhere in the app.
function bindDocumentDownloadLinks(container) {
  container.querySelectorAll('[data-download-doc]').forEach(link => {
    link.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        const blobUrl = await authenticatedBlobUrl(link.dataset.fileUrl);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = link.dataset.fileName || 'document';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
      } catch (err) {
        alert('Could not download the file: ' + err.message);
      }
    });
  });
}

async function showDocumentHistoryModal(main, docId) {
  const modalRoot = main.querySelector('#document-modal-root');
  if (!modalRoot) return;

  let data;
  try {
    data = await api('/documents/' + docId + '/versions');
  } catch (e) {
    alert(e.message);
    return;
  }

  const { docNumber, versions } = data;

  modalRoot.innerHTML = `
    <div class="modal-overlay" id="document-modal-overlay">
      <div class="modal-card modal-card-wide">
        <button class="modal-close" id="document-modal-close">&times;</button>
        <h2>${escapeHtml(docNumber)}</h2>
        <p class="subtitle">Version history</p>
        <div class="import-preview-scroll">
          <table>
            <thead><tr><th>Version</th><th>Status</th><th>Description</th><th>Uploaded By</th><th>Uploaded</th><th></th></tr></thead>
            <tbody>
              ${versions.map(v => `
                <tr>
                  <td><strong>${escapeHtml(v.version)}</strong></td>
                  <td><span class="badge ${v.isCurrent ? 'badge-current' : 'badge-superseded'}">${v.isCurrent ? 'Current' : 'Superseded'}</span></td>
                  <td>${v.description ? escapeHtml(v.description) : '<span class="hint">—</span>'}</td>
                  <td>${v.uploader ? escapeHtml(v.uploader.name) : '—'}</td>
                  <td>${formatDate(v.uploadedAt.slice(0, 10))}</td>
                  <td><a href="#" data-download-doc data-file-url="${escapeHtml(v.fileUrl)}" data-file-name="${escapeHtml(v.originalFileName)}">Download</a></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  const overlay = document.getElementById('document-modal-overlay');
  const close = () => { modalRoot.innerHTML = ''; };
  document.getElementById('document-modal-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  bindDocumentDownloadLinks(modalRoot);
}

// ---------------- PROJECT SNAGS / DEFECTS ----------------
// Small, fixed list — unlike task statuses/roles/stages, this isn't
// admin-editable, matching how RFI status ("Open"/"Answered") works too.
const SNAG_STATUSES = ['Open', 'In Progress', 'Resolved'];

async function renderProjectSnags(main, projectId) {
  main.innerHTML = `<p class="subtitle">Loading…</p>`;
  let project, snags;
  try {
    project = await api('/projects/' + projectId);
    snags = await api('/projects/' + projectId + '/snags');
  } catch (e) {
    main.innerHTML = `<button class="back-link" id="back-to-projects">&larr; Back to Projects</button><p class="error-text">${escapeHtml(e.message)}</p>`;
    main.querySelector('#back-to-projects').addEventListener('click', () => setView('projects'));
    return;
  }

  const isManager = state.me.isAdmin || project.createdBy === state.me.id;

  const cardsHtml = snags.length === 0
    ? emptyStateHtml('No snags logged yet.')
    : `<div class="grid">${snags.map(s => `
        <div class="card snag-card" data-open-snag="${s.id}">
          <div class="snag-pin-wrap snag-thumb-wrap">
            <img data-photo-url="${escapeHtml(s.photoUrl)}" class="snag-thumb" alt="" />
            ${s.pinX != null ? `<div class="snag-pin" style="left:${s.pinX}%; top:${s.pinY}%;"></div>` : ''}
          </div>
          <p class="snag-card-desc">${escapeHtml(s.description)}</p>
          <div class="meta">
            <span class="status ${escapeHtml(statusClass(s.status))}">${escapeHtml(s.status)}</span>
            <span>${s.assignee ? escapeHtml(s.assignee.name) : 'Unassigned'}</span>
          </div>
        </div>
      `).join('')}</div>`;

  main.innerHTML = `
    <button class="back-link" id="back-to-projects">&larr; Back to Projects</button>
    <h1>${escapeHtml(project.name)}</h1>
    <p class="subtitle">Snags / defects logged for this project. Click one to see its photo, pinned location, and status history.</p>
    ${projectTabsHtml('project-snags')}
    <div class="section-header">
      <div></div>
      <button class="btn" id="log-snag-btn">Log a Snag</button>
    </div>
    ${cardsHtml}
    <div id="snag-modal-root"></div>
  `;

  main.querySelector('#back-to-projects').addEventListener('click', () => setView('projects'));
  bindProjectTabs(main, projectId);

  main.querySelectorAll('[data-photo-url]').forEach(img => {
    authenticatedBlobUrl(img.dataset.photoUrl)
      .then(blobUrl => { img.src = blobUrl; })
      .catch(() => { img.alt = 'Could not load photo'; });
  });

  main.querySelectorAll('[data-open-snag]').forEach(card => {
    card.addEventListener('click', () => {
      const snag = snags.find(s => s.id === Number(card.dataset.openSnag));
      if (snag) showSnagDetailModal(main, projectId, snag, isManager, () => renderProjectSnags(main, projectId));
    });
  });

  main.querySelector('#log-snag-btn').addEventListener('click', () => {
    showSnagFormModal(main, projectId, { mode: 'upload' }, () => renderProjectSnags(main, projectId));
  });

  // A "Log as Snag" click from a Site Visit Report (see showReportModal)
  // navigates here and leaves a one-shot prefill on state for this render to
  // pick up and open immediately — setView() itself has no way to carry
  // extra options through to an async view render.
  if (state.pendingSnagFromReport) {
    const prefill = state.pendingSnagFromReport;
    state.pendingSnagFromReport = null;
    showSnagFormModal(main, projectId, prefill, () => renderProjectSnags(main, projectId));
  }
}

// Wires click-to-place-a-pin on `imgEl` (already positioned inside a
// .snag-pin-wrap), showing/moving `markerEl` and reporting the new
// percentage position via `onPlaced(x, y)`. Shared by the "upload a new
// photo" and "reuse a report's photo" creation flows, and by nothing else —
// an existing snag's pin is read-only, just an absolutely-positioned marker.
function bindSnagPinPlacement(imgEl, markerEl, statusEl, onPlaced) {
  imgEl.addEventListener('click', (e) => {
    const rect = imgEl.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
    markerEl.style.left = x + '%';
    markerEl.style.top = y + '%';
    markerEl.hidden = false;
    if (statusEl) statusEl.textContent = 'Pin placed — click the photo again to move it.';
    onPlaced(x, y);
  });
}

// opts:
//   { mode: 'upload' }
//   { mode: 'from-report', reportId, photoFileName, photoUrl, prefillDescription }
async function showSnagFormModal(main, projectId, opts, onCreated) {
  const modalRoot = main.querySelector('#snag-modal-root');
  if (!modalRoot) return;

  let pin = { x: null, y: null };

  modalRoot.innerHTML = `
    <div class="modal-overlay" id="snag-modal-overlay">
      <div class="modal-card modal-card-wide">
        <button class="modal-close" id="snag-modal-close">&times;</button>
        <h2>Log a Snag</h2>
        <form id="snag-form">
          <div class="form-row">
            <div>
              <label>Status</label>
              <select name="status">${SNAG_STATUSES.map(s => `<option value="${s}">${s}</option>`).join('')}</select>
            </div>
            <div>
              <label>Assign to</label>
              <select name="assigneeId">
                <option value="">— Unassigned —</option>
                ${state.users.map(u => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div>
            <label>Description</label>
            <textarea name="description" required placeholder="Short description of the issue">${escapeHtml(opts.prefillDescription || '')}</textarea>
          </div>
          ${opts.mode === 'upload' ? `<div><label>Photo</label><input type="file" name="photo" accept="image/*" required /></div>` : ''}
          <div>
            <label>Pin the issue's location on the photo (optional — click the photo)</label>
            <div id="snag-photo-picker">
              <p class="hint">${opts.mode === 'upload' ? 'Choose a photo above first.' : 'Loading photo…'}</p>
            </div>
          </div>
          <div id="snag-form-error" class="error-text"></div>
          <button class="btn" type="submit">Create Snag</button>
        </form>
      </div>
    </div>
  `;

  const overlay = document.getElementById('snag-modal-overlay');
  const close = () => { modalRoot.innerHTML = ''; };
  document.getElementById('snag-modal-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const picker = document.getElementById('snag-photo-picker');
  function renderPicker(src) {
    picker.innerHTML = `
      <div class="snag-pin-wrap">
        <img src="${src}" id="snag-pin-img" />
        <div class="snag-pin" id="snag-pin-marker" hidden></div>
      </div>
      <p class="hint" id="snag-pin-status">Click the photo to place a pin (optional).</p>
    `;
    bindSnagPinPlacement(
      document.getElementById('snag-pin-img'),
      document.getElementById('snag-pin-marker'),
      document.getElementById('snag-pin-status'),
      (x, y) => { pin = { x, y }; }
    );
  }

  if (opts.mode === 'from-report') {
    try {
      const blobUrl = await authenticatedBlobUrl(opts.photoUrl);
      renderPicker(blobUrl);
    } catch (err) {
      picker.innerHTML = `<p class="error-text">Could not load the photo from that report.</p>`;
    }
  } else {
    modalRoot.querySelector('input[name="photo"]').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      pin = { x: null, y: null };
      renderPicker(URL.createObjectURL(file));
    });
  }

  modalRoot.querySelector('#snag-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const errBox = document.getElementById('snag-form-error');
    errBox.textContent = '';
    const submitBtn = form.querySelector('button[type="submit"]');

    try {
      if (opts.mode === 'from-report') {
        await api('/projects/' + projectId + '/snags/from-report', {
          method: 'POST',
          body: JSON.stringify({
            reportId: opts.reportId,
            photoFileName: opts.photoFileName,
            description: form.description.value,
            status: form.status.value,
            assigneeId: form.assigneeId.value || null,
            pinX: pin.x,
            pinY: pin.y
          })
        });
      } else {
        const fileInput = form.querySelector('input[name="photo"]');
        if (!fileInput.files[0]) {
          errBox.textContent = 'Please choose a photo.';
          return;
        }
        submitBtn.disabled = true;
        const formData = new FormData();
        formData.append('photos', fileInput.files[0]); // shared 'upload' multer instance's image-checked field name
        formData.append('description', form.description.value);
        formData.append('status', form.status.value);
        if (form.assigneeId.value) formData.append('assigneeId', form.assigneeId.value);
        if (pin.x != null) {
          formData.append('pinX', pin.x);
          formData.append('pinY', pin.y);
        }
        await apiUpload('/projects/' + projectId + '/snags', formData);
      }
      close();
      if (onCreated) onCreated();
    } catch (err) {
      submitBtn.disabled = false;
      errBox.textContent = err.message;
    }
  });
}

async function showSnagDetailModal(main, projectId, snag, isManager, onUpdated) {
  const modalRoot = main.querySelector('#snag-modal-root');
  if (!modalRoot) return;

  const canEditStatus = isManager || snag.assigneeId === state.me.id;

  modalRoot.innerHTML = `
    <div class="modal-overlay" id="snag-detail-overlay">
      <div class="modal-card modal-card-wide">
        <button class="modal-close" id="snag-detail-close">&times;</button>
        <h2>Snag</h2>
        <div id="snag-detail-photo-wrap"><p class="hint">Loading photo…</p></div>
        <p class="subtitle">${escapeHtml(snag.description)}</p>
        <div class="form-row">
          <div>
            <label>Status</label>
            ${canEditStatus
              ? `<select class="select-inline" id="snag-detail-status">${SNAG_STATUSES.map(s => `<option value="${s}" ${s === snag.status ? 'selected' : ''}>${s}</option>`).join('')}</select>`
              : `<div><span class="status ${escapeHtml(statusClass(snag.status))}">${escapeHtml(snag.status)}</span></div>`}
          </div>
          <div>
            <label>Assigned to</label>
            ${isManager
              ? `<select class="select-inline" id="snag-detail-assignee">
                  <option value="">— Unassigned —</option>
                  ${state.users.map(u => `<option value="${u.id}" ${snag.assigneeId === u.id ? 'selected' : ''}>${escapeHtml(u.name)}</option>`).join('')}
                </select>`
              : `<div>${snag.assignee ? escapeHtml(snag.assignee.name) : 'Unassigned'}</div>`}
          </div>
        </div>
        <p class="hint">Logged by ${snag.createdByUser ? escapeHtml(snag.createdByUser.name) : 'Unknown'} on ${formatDate(snag.createdAt.slice(0, 10))}</p>
        <div id="snag-detail-error" class="error-text"></div>

        <h3>Status History</h3>
        <ul class="modal-team-list">
          ${snag.statusHistory.slice().reverse().map(h => `
            <li>
              <span class="status ${escapeHtml(statusClass(h.status))}">${escapeHtml(h.status)}</span>
              <span class="hint">${h.changedByUser ? escapeHtml(h.changedByUser.name) : 'Unknown'} &middot; ${formatDate(h.changedAt.slice(0, 10))}</span>
            </li>
          `).join('')}
        </ul>
      </div>
    </div>
  `;

  const overlay = document.getElementById('snag-detail-overlay');
  const close = () => { modalRoot.innerHTML = ''; };
  document.getElementById('snag-detail-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const photoWrap = document.getElementById('snag-detail-photo-wrap');
  authenticatedBlobUrl(snag.photoUrl)
    .then(blobUrl => {
      photoWrap.innerHTML = `
        <div class="snag-pin-wrap">
          <img src="${blobUrl}" />
          ${snag.pinX != null ? `<div class="snag-pin" style="left:${snag.pinX}%; top:${snag.pinY}%;"></div>` : ''}
        </div>
      `;
    })
    .catch(() => { photoWrap.innerHTML = '<p class="error-text">Could not load the photo.</p>'; });

  const refresh = () => { close(); if (onUpdated) onUpdated(); };
  const errBox = document.getElementById('snag-detail-error');

  const statusSelect = document.getElementById('snag-detail-status');
  if (statusSelect) {
    statusSelect.addEventListener('change', async () => {
      try {
        await api('/snags/' + snag.id, { method: 'PATCH', body: JSON.stringify({ status: statusSelect.value }) });
        refresh();
      } catch (err) {
        errBox.textContent = err.message;
      }
    });
  }
  const assigneeSelect = document.getElementById('snag-detail-assignee');
  if (assigneeSelect) {
    assigneeSelect.addEventListener('change', async () => {
      try {
        await api('/snags/' + snag.id, {
          method: 'PATCH',
          body: JSON.stringify({ assigneeId: assigneeSelect.value ? Number(assigneeSelect.value) : null })
        });
        refresh();
      } catch (err) {
        errBox.textContent = err.message;
      }
    });
  }
}

// ---------------- TEAM (admin) ----------------

async function renderTeam(main) {
  main.innerHTML = `<h1>Team</h1><p class="subtitle">Loading…</p>`;
  let users;
  try {
    users = await api('/users');
  } catch (e) {
    main.innerHTML = `<h1>Team</h1><p class="error-text">${escapeHtml(e.message)}</p>`;
    return;
  }

  const roleOptions = state.roles.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('');

  const rows = users.map(u => `
    <tr>
      <td>${escapeHtml(u.name)}</td>
      <td>${escapeHtml(u.email)}</td>
      <td>${u.phone ? escapeHtml(u.phone) : '<span class="hint">—</span>'}</td>
      <td><span class="badge role-${escapeHtml(u.role)}">${escapeHtml(u.role)}</span></td>
      <td>${u.isAdmin ? '<span class="badge admin">Admin</span>' : ''}</td>
    </tr>
  `).join('');

  main.innerHTML = `
    <h1>Team</h1>
    <p class="subtitle">Invite team members and see everyone's engineering role.</p>

    <div class="card">
      <h2>Invite Team Member</h2>
      <p class="hint">v1: this creates their account directly (no email is actually sent yet). Share the password with them yourself — there's no self-service password change yet.</p>
      <form id="invite-form">
        <div class="form-row">
          <div><label>Name</label><input name="name" required placeholder="Full name" /></div>
          <div><label>Email</label><input name="email" type="email" required placeholder="name@company.com" /></div>
          <div><label>Phone</label><input name="phone" type="tel" placeholder="555-0100" /></div>
          <div><label>Role</label><select name="role">${roleOptions}</select></div>
          <div><label>Password</label><input name="password" type="password" required minlength="8" placeholder="At least 8 characters" /></div>
        </div>
        <div id="invite-form-error" class="error-text"></div>
        <button class="btn" type="submit">Send Invite</button>
      </form>
    </div>

    <div class="card">
      <h2>Team Members</h2>
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Admin</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  main.querySelector('#invite-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const errBox = form.querySelector('#invite-form-error');
    errBox.textContent = '';
    try {
      await api('/users', {
        method: 'POST',
        body: JSON.stringify({ name: form.name.value, email: form.email.value, phone: form.phone.value, role: form.role.value, password: form.password.value })
      });
      state.users = await api('/users');
      renderTeam(main);
    } catch (err) {
      errBox.textContent = err.message;
    }
  });
}

// ---------------- ADMIN SETTINGS (editable option lists) ----------------

// Every customizable dropdown in the app, managed the same way: view, add, remove
// (blocked with a clear message if still in use). Adding a new list later just
// means adding one more entry here.
const SETTINGS_LISTS = [
  {
    key: 'roles',
    title: 'Engineering Roles',
    path: '/roles',
    hint: 'Used for a team member\'s specialism and a task\'s required discipline.',
    badgeClass: (v) => `role-${v}`
  },
  {
    key: 'stages',
    title: 'Project Stages',
    path: '/stages',
    hint: 'A project\'s current stage, shown on the Portfolio Timeline.',
    badgeClass: (v) => `stage-${v}`
  },
  {
    key: 'taskStatuses',
    title: 'Task Status Columns',
    path: '/task-statuses',
    hint: 'The columns shown on each project\'s Kanban board, in order.',
    badgeClass: () => 'badge-outline'
  },
  {
    key: 'externalContactCategories',
    title: 'External Contact Categories',
    path: '/external-contact-categories',
    hint: 'Categories for external stakeholders (subcontractors, consultants, etc.).',
    badgeClass: () => 'badge-outline'
  }
];

function optionListSectionHtml(cfg, list) {
  return `
    <div class="option-list-section">
      <h2>${escapeHtml(cfg.title)}</h2>
      <p class="hint">${escapeHtml(cfg.hint)}</p>
      <div class="option-list">
        ${list.length === 0 ? '<p class="hint">No options yet.</p>' : list.map(v => `
          <div class="option-row">
            <span class="badge ${escapeHtml(cfg.badgeClass(v))}">${escapeHtml(v)}</span>
            <button class="btn small secondary" data-remove-option data-settings-key="${cfg.key}" data-value="${escapeHtml(v)}">Remove</button>
          </div>
        `).join('')}
      </div>
      <form class="form-row" data-add-option-form data-settings-key="${cfg.key}" style="margin-top:0.8rem; align-items:flex-end;">
        <div><label>Add new</label><input name="value" required placeholder="Type a name…" /></div>
        <button class="btn" type="submit">Add</button>
      </form>
      <div class="error-text" data-settings-error="${cfg.key}"></div>
    </div>
  `;
}

function bindSettingsSections(main) {
  main.querySelectorAll('[data-add-option-form]').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const key = form.dataset.settingsKey;
      const cfg = SETTINGS_LISTS.find(c => c.key === key);
      const errBox = main.querySelector(`[data-settings-error="${key}"]`);
      errBox.textContent = '';
      try {
        state[key] = await api(cfg.path, { method: 'POST', body: JSON.stringify({ name: form.value.value }) });
        renderSettings(main);
      } catch (err) {
        errBox.textContent = err.message;
      }
    });
  });

  main.querySelectorAll('[data-remove-option]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.settingsKey;
      const cfg = SETTINGS_LISTS.find(c => c.key === key);
      const value = btn.dataset.value;
      const errBox = main.querySelector(`[data-settings-error="${key}"]`);
      errBox.textContent = '';
      if (!confirm(`Remove "${value}"?`)) return;
      try {
        state[key] = await api(cfg.path, { method: 'DELETE', body: JSON.stringify({ name: value }) });
        renderSettings(main);
      } catch (err) {
        errBox.textContent = err.message;
      }
    });
  });
}

async function renderSettings(main) {
  main.innerHTML = `<h1>Settings</h1><p class="subtitle">Loading…</p>`;
  try {
    state.roles = await api('/roles');
    state.stages = await api('/stages');
    state.taskStatuses = await api('/task-statuses');
    state.externalContactCategories = await api('/external-contact-categories');
  } catch (e) {
    main.innerHTML = `<h1>Settings</h1><p class="error-text">${escapeHtml(e.message)}</p>`;
    return;
  }

  const sectionsHtml = SETTINGS_LISTS.map(cfg => optionListSectionHtml(cfg, state[cfg.key])).join('');

  main.innerHTML = `
    <h1>Settings</h1>
    <p class="subtitle">Manage every customizable list used across the app, all in one place.</p>
    <div class="card">
      ${sectionsHtml}
      <div class="option-list-section">
        <h2>RFI Status</h2>
        <p class="hint">Set automatically based on whether an RFI has been answered — not directly editable.</p>
        <div class="option-list">
          <div class="option-row"><span class="status status-Open">Open</span></div>
          <div class="option-row"><span class="status status-Answered">Answered</span></div>
        </div>
      </div>
    </div>
  `;

  bindSettingsSections(main);
}

// ---------------- WEATHER (shared by Portfolio Timeline + project pages) ----------------
// A project's forecast is fetched lazily (after the page it appears on has
// already rendered) and dropped into a placeholder element, the same way
// photo/audio blobs load in elsewhere — so a slow or failed weather request
// never blocks or breaks the page it's shown on.

const WEATHER_ICONS = {
  0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
  45: '🌫️', 48: '🌫️',
  51: '🌦️', 53: '🌦️', 55: '🌦️', 56: '🌦️', 57: '🌦️',
  61: '🌧️', 63: '🌧️', 65: '🌧️', 66: '🌧️', 67: '🌧️', 80: '🌧️', 81: '🌧️', 82: '🌧️',
  71: '❄️', 73: '❄️', 75: '❄️', 77: '❄️', 85: '❄️', 86: '❄️',
  95: '⛈️', 96: '⛈️', 99: '⛈️'
};
function weatherIcon(code) {
  return WEATHER_ICONS[code] || '🌡️';
}

// `compact` (used on the Portfolio Gantt row, where space is tight) shows
// icons only; the fuller version (project modal, project page) adds the day
// label and high temp. Either way, a day flagged impactful gets a visible
// ring and a ⚠ badge, and every day's title tooltip spells out why.
function weatherStripHtml(forecast, opts) {
  opts = opts || {};
  if (!forecast || forecast.length === 0) return '';
  return `
    <div class="weather-strip${opts.compact ? ' weather-strip-compact' : ''}">
      ${forecast.map(d => {
        const dayLabel = new Date(d.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' });
        const title = `${dayLabel} ${formatDate(d.date)}: high ${Math.round(d.tempMax)}°C, low ${Math.round(d.tempMin)}°C — ${d.impactful ? d.impactReasons.join(', ') : 'no significant impact expected'}`;
        return `
          <div class="weather-day${d.impactful ? ' weather-day-impact' : ''}" title="${escapeHtml(title)}">
            ${opts.compact ? '' : `<div class="weather-day-label">${escapeHtml(dayLabel)}</div>`}
            <div class="weather-day-icon">${weatherIcon(d.weatherCode)}</div>
            ${opts.compact ? '' : `<div class="weather-day-temp">${Math.round(d.tempMax)}&deg;</div>`}
            ${d.impactful ? '<div class="weather-day-flag">&#9888;</div>' : ''}
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// Fetches and renders straight into `container`; silently leaves it empty
// on any failure (no location set, API hiccup, etc.) rather than showing an
// error in what's meant to be a small, low-stakes widget.
async function loadWeatherInto(container, projectId, opts) {
  if (!container) return;
  try {
    const forecast = await api('/projects/' + projectId + '/weather');
    container.innerHTML = weatherStripHtml(forecast, opts);
  } catch (e) {
    container.innerHTML = '';
  }
}

// ---------------- PORTFOLIO TIMELINE ----------------

function formatDate(str) {
  if (!str) return '—';
  const d = new Date(str + 'T00:00:00');
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function monthLabel(d) {
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
}

async function renderPortfolio(main) {
  main.innerHTML = `<h1>Portfolio Timeline</h1><p class="subtitle">Loading…</p>`;
  let projects;
  try {
    projects = await api('/portfolio');
  } catch (e) {
    main.innerHTML = `<h1>Portfolio Timeline</h1><p class="error-text">${escapeHtml(e.message)}</p>`;
    return;
  }

  if (projects.length === 0) {
    main.innerHTML = `<h1>Portfolio Timeline</h1>${emptyStateHtml('No projects yet.')}`;
    return;
  }

  const sorted = [...projects].sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

  const starts = sorted.map(p => new Date(p.startDate + 'T00:00:00').getTime());
  const ends = sorted.map(p => new Date(p.endDate + 'T00:00:00').getTime());
  const rawMin = Math.min(...starts);
  const rawMax = Math.max(...ends);
  const pad = Math.max((rawMax - rawMin) * 0.05, 3 * 24 * 60 * 60 * 1000);
  const rangeMin = rawMin - pad;
  const rangeMax = rawMax + pad;
  const rangeSpan = rangeMax - rangeMin;

  const pct = (time) => ((time - rangeMin) / rangeSpan) * 100;

  // month tick marks
  const ticks = [];
  const cursor = new Date(rangeMin);
  cursor.setDate(1);
  const rangeMaxDate = new Date(rangeMax);
  while (cursor.getTime() <= rangeMaxDate.getTime()) {
    ticks.push({ left: pct(cursor.getTime()), label: monthLabel(cursor) });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const rowsHtml = sorted.map(p => {
    const startMs = new Date(p.startDate + 'T00:00:00').getTime();
    const endMs = new Date(p.endDate + 'T00:00:00').getTime();
    const left = pct(startMs);
    const width = Math.max(pct(endMs) - left, 1.5);
    const progress = p.progress || 0;
    const color = p.color || '#1e3a5f';
    const canEdit = state.me.isAdmin || p.createdBy === state.me.id;
    const handlesHtml = canEdit
      ? `<div class="gantt-bar-handle gantt-bar-handle-start" data-resize="start"></div><div class="gantt-bar-handle gantt-bar-handle-end" data-resize="end"></div>`
      : '';
    return `
      <div class="gantt-row">
        <div class="gantt-label">
          <div>${escapeHtml(p.name)}</div>
          <span class="badge stage-${escapeHtml(p.stage)}">${escapeHtml(p.stage)}</span>
          <div class="gantt-progress-track"><div class="gantt-progress-fill" style="width:${progress}%; background:${color};"></div></div>
          <span class="hint gantt-progress-pct">${progress}% complete</span>
          ${p.location ? `<div data-weather-for="${p.id}"></div>` : ''}
        </div>
        <div class="gantt-track">
          <div class="gantt-bar${canEdit ? ' gantt-bar-draggable' : ''}" data-project="${p.id}" style="left:${left}%; width:${width}%; background:${color};" title="${escapeHtml(p.name)} — ${progress}% complete">
            <div class="gantt-bar-remaining" style="width:${100 - progress}%;"></div>
            <span class="gantt-bar-text">${escapeHtml(p.name)} · ${progress}%</span>
            ${handlesHtml}
          </div>
        </div>
      </div>
    `;
  }).join('');

  const ticksHtml = ticks.map(t => `<div class="gantt-tick" style="left:${t.left}%">${t.label}</div>`).join('');

  main.innerHTML = `
    <h1>Portfolio Timeline</h1>
    <p class="subtitle">All projects across the organisation. Click a bar to see project details, change its color, or update progress.</p>
    <div class="card gantt">
      <div class="gantt-inner">
        <div class="gantt-scale">
          <div class="gantt-scale-track">${ticksHtml}</div>
        </div>
        ${rowsHtml}
      </div>
    </div>
    <div id="portfolio-modal-root"></div>
  `;

  bindGanttBarInteractions(main, projects, rangeMin, rangeSpan);

  main.querySelectorAll('[data-weather-for]').forEach(el => {
    loadWeatherInto(el, Number(el.dataset.weatherFor), { compact: true });
  });
}

const GANTT_DAY_MS = 24 * 60 * 60 * 1000;

function ganttFormatShort(ms) {
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function ganttMsToIsoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// Wires up click-to-view, drag-edge-to-resize dates, and drag-the-body-to-set-
// progress on each bar. A plain click (no meaningful mouse movement) still opens
// the details modal; only once the user actually drags do we save anything.
function bindGanttBarInteractions(main, projects, rangeMin, rangeSpan) {
  const pct = (time) => ((time - rangeMin) / rangeSpan) * 100;

  main.querySelectorAll('.gantt-bar').forEach(bar => {
    const project = projects.find(p => p.id === Number(bar.dataset.project));
    if (!project) return;

    if (!bar.classList.contains('gantt-bar-draggable')) {
      bar.addEventListener('click', () => showProjectModal(project, main));
      return;
    }

    const track = bar.closest('.gantt-track');
    const row = bar.closest('.gantt-row');
    const textEl = bar.querySelector('.gantt-bar-text');
    const remainingEl = bar.querySelector('.gantt-bar-remaining');
    const labelFillEl = row ? row.querySelector('.gantt-progress-fill') : null;
    const labelPctEl = row ? row.querySelector('.gantt-progress-pct') : null;

    // --- drag an edge handle: resize just that side's date, duration only ---
    const beginResizeDrag = (mode) => (e) => {
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const trackWidth = track.getBoundingClientRect().width;
      const origStartMs = new Date(project.startDate + 'T00:00:00').getTime();
      const origEndMs = new Date(project.endDate + 'T00:00:00').getTime();
      let dragged = false;
      let newStartMs = origStartMs;
      let newEndMs = origEndMs;

      const tooltip = document.createElement('div');
      tooltip.className = 'gantt-drag-tooltip';
      document.body.appendChild(tooltip);
      document.body.classList.add('gantt-dragging');

      function updateTooltip(clientX, clientY) {
        tooltip.style.left = clientX + 'px';
        tooltip.style.top = (clientY - 36) + 'px';
        tooltip.textContent = `${ganttFormatShort(newStartMs)} – ${ganttFormatShort(newEndMs)} · ${project.progress || 0}%`;
      }

      function onMove(ev) {
        const dx = ev.clientX - startX;
        if (Math.abs(dx) > 3) dragged = true;
        if (!dragged) return;

        const deltaMs = (dx / trackWidth) * rangeSpan;

        if (mode === 'resize-start') {
          newStartMs = Math.min(origStartMs + deltaMs, origEndMs - GANTT_DAY_MS);
          newEndMs = origEndMs;
        } else {
          newEndMs = Math.max(origEndMs + deltaMs, origStartMs + GANTT_DAY_MS);
          newStartMs = origStartMs;
        }

        const left = pct(newStartMs);
        const width = Math.max(pct(newEndMs) - left, 1.5);
        bar.style.left = left + '%';
        bar.style.width = width + '%';
        if (textEl) textEl.textContent = `${project.name} · ${project.progress || 0}%`;
        updateTooltip(ev.clientX, ev.clientY);
      }

      async function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.classList.remove('gantt-dragging');
        tooltip.remove();

        if (!dragged) {
          showProjectModal(project, main);
          return;
        }

        try {
          await api('/projects/' + project.id, {
            method: 'PATCH',
            body: JSON.stringify({ startDate: ganttMsToIsoDate(newStartMs), endDate: ganttMsToIsoDate(newEndMs) })
          });
        } catch (err) {
          alert(err.message);
        }
        renderPortfolio(main);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };

    // --- drag the bar body: set progress by how far across the bar the cursor is ---
    function beginProgressDrag(e) {
      e.preventDefault();
      e.stopPropagation();

      const barRect = bar.getBoundingClientRect();
      const startX = e.clientX;
      let dragged = false;
      let newProgress = project.progress || 0;

      const tooltip = document.createElement('div');
      tooltip.className = 'gantt-drag-tooltip';
      document.body.appendChild(tooltip);
      document.body.classList.add('gantt-dragging');

      function computeProgress(clientX) {
        const relativeX = clientX - barRect.left;
        return Math.max(0, Math.min(100, Math.round((relativeX / barRect.width) * 100)));
      }

      function updateVisual(clientX, clientY) {
        if (remainingEl) remainingEl.style.width = (100 - newProgress) + '%';
        if (textEl) textEl.textContent = `${project.name} · ${newProgress}%`;
        if (labelFillEl) labelFillEl.style.width = newProgress + '%';
        if (labelPctEl) labelPctEl.textContent = `${newProgress}% complete`;
        tooltip.style.left = clientX + 'px';
        tooltip.style.top = (clientY - 36) + 'px';
        tooltip.textContent = `${newProgress}% complete`;
      }

      function onMove(ev) {
        if (Math.abs(ev.clientX - startX) > 3) dragged = true;
        if (!dragged) return;
        newProgress = computeProgress(ev.clientX);
        updateVisual(ev.clientX, ev.clientY);
      }

      async function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.classList.remove('gantt-dragging');
        tooltip.remove();

        if (!dragged) {
          showProjectModal(project, main);
          return;
        }

        try {
          await api('/projects/' + project.id, {
            method: 'PATCH',
            body: JSON.stringify({ progress: newProgress })
          });
        } catch (err) {
          alert(err.message);
        }
        renderPortfolio(main);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }

    bar.addEventListener('mousedown', beginProgressDrag);
    const startHandle = bar.querySelector('[data-resize="start"]');
    const endHandle = bar.querySelector('[data-resize="end"]');
    if (startHandle) startHandle.addEventListener('mousedown', beginResizeDrag('resize-start'));
    if (endHandle) endHandle.addEventListener('mousedown', beginResizeDrag('resize-end'));
  });
}

function showProjectModal(project, boardMain) {
  const modalRoot = document.getElementById('portfolio-modal-root');
  if (!modalRoot) return;

  const canEdit = state.me.isAdmin || project.createdBy === state.me.id;
  const color = project.color || '#1e3a5f';
  const progress = project.progress || 0;
  const isManualProgress = project.progressMode === 'manual';
  const taskProgress = project.taskProgress || { done: 0, total: 0 };
  const progressHint = isManualProgress
    ? 'Manually set — overrides the automatic calculation.'
    : `Calculated automatically: average progress across ${taskProgress.total} task${taskProgress.total === 1 ? '' : 's'} (${taskProgress.done} fully done).`;

  const teamHtml = project.team.length === 0
    ? `<p class="hint">No team members assigned yet.</p>`
    : `<ul class="modal-team-list">${project.team.map(u => `
        <li>
          <span>${escapeHtml(u.name)}</span>
          <span class="badge role-${escapeHtml(u.role)}">${escapeHtml(u.role)}</span>
        </li>
      `).join('')}</ul>`;

  const colorProgressHtml = canEdit
    ? `
      <div class="form-row">
        <div>
          <label>Bar Color</label>
          <input type="color" id="project-modal-color" value="${color}" style="width:100%; height:2.3rem; padding:0.2rem; cursor:pointer;" />
        </div>
        <div>
          <label>Progress (%)</label>
          <input type="number" id="project-modal-progress" min="0" max="100" step="1" value="${progress}" />
        </div>
      </div>
      <p class="hint">${escapeHtml(progressHint)}${isManualProgress ? ' <button class="btn small secondary" id="project-modal-reset-progress" type="button">Reset to Automatic</button>' : ''}</p>
      <div id="project-modal-error" class="error-text"></div>
    `
    : `
      <div class="modal-dates">
        <div><label>Color</label><div><span style="display:inline-block; width:14px; height:14px; border-radius:3px; background:${color}; vertical-align:middle;"></span></div></div>
        <div><label>Progress</label><div>${progress}%</div></div>
      </div>
      <p class="hint">${escapeHtml(progressHint)}</p>
    `;

  const locationHtml = canEdit
    ? `
      <div>
        <label>Location (for weather forecast)</label>
        <input type="text" id="project-modal-location" value="${escapeHtml(project.location || '')}" placeholder="e.g. Denver, CO" />
      </div>
      <div id="project-modal-location-error" class="error-text"></div>
    `
    : (project.location ? `<p class="hint">Location: ${escapeHtml(project.location)}</p>` : '');

  modalRoot.innerHTML = `
    <div class="modal-overlay" id="project-modal-overlay">
      <div class="modal-card">
        <button class="modal-close" id="project-modal-close">&times;</button>
        <h2>${escapeHtml(project.name)}</h2>
        <span class="badge stage-${escapeHtml(project.stage)}">${escapeHtml(project.stage)}</span>
        <p class="subtitle">${escapeHtml(project.description || '')}</p>
        <div class="modal-dates">
          <div><label>Start Date</label><div>${formatDate(project.startDate)}</div></div>
          <div><label>End Date</label><div>${formatDate(project.endDate)}</div></div>
        </div>
        ${colorProgressHtml}
        ${locationHtml}
        <div id="project-modal-weather"></div>
        <h3>Assigned Team Members</h3>
        ${teamHtml}
      </div>
    </div>
  `;

  const overlay = document.getElementById('project-modal-overlay');
  const close = () => { modalRoot.innerHTML = ''; };
  document.getElementById('project-modal-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  if (project.location) {
    loadWeatherInto(document.getElementById('project-modal-weather'), project.id, {});
  }

  const locationInput = document.getElementById('project-modal-location');
  if (locationInput) {
    locationInput.addEventListener('change', async () => {
      const locErrBox = document.getElementById('project-modal-location-error');
      locErrBox.textContent = '';
      try {
        const updated = await api('/projects/' + project.id, {
          method: 'PATCH',
          body: JSON.stringify({ location: locationInput.value })
        });
        project.location = updated.location;
        loadWeatherInto(document.getElementById('project-modal-weather'), project.id, {});
        renderPortfolio(boardMain);
      } catch (err) {
        locErrBox.textContent = err.message;
      }
    });
  }

  if (canEdit) {
    const errBox = document.getElementById('project-modal-error');
    const colorInput = document.getElementById('project-modal-color');
    const progressInput = document.getElementById('project-modal-progress');

    colorInput.addEventListener('change', async () => {
      errBox.textContent = '';
      try {
        await api('/projects/' + project.id, { method: 'PATCH', body: JSON.stringify({ color: colorInput.value }) });
        renderPortfolio(boardMain);
      } catch (err) {
        errBox.textContent = err.message;
      }
    });

    progressInput.addEventListener('change', async () => {
      errBox.textContent = '';
      const value = Number(progressInput.value);
      if (Number.isNaN(value) || value < 0 || value > 100) {
        errBox.textContent = 'Progress must be a number between 0 and 100';
        return;
      }
      try {
        await api('/projects/' + project.id, { method: 'PATCH', body: JSON.stringify({ progress: value }) });
        renderPortfolio(boardMain);
      } catch (err) {
        errBox.textContent = err.message;
      }
    });

    const resetBtn = document.getElementById('project-modal-reset-progress');
    if (resetBtn) {
      resetBtn.addEventListener('click', async () => {
        errBox.textContent = '';
        try {
          await api('/projects/' + project.id, { method: 'PATCH', body: JSON.stringify({ progressMode: 'auto' }) });
          renderPortfolio(boardMain);
        } catch (err) {
          errBox.textContent = err.message;
        }
      });
    }
  }
}

// ---------------- OFFSITE REPORTS ----------------

function reportStatusBadge(status) {
  return status === 'approved'
    ? `<span class="badge badge-outline" style="border-color:#bbf7d0;color:#15803d;background:#f0fdf4;">Approved</span>`
    : `<span class="badge badge-outline">Pending Review</span>`;
}

async function renderOffsiteReports(main) {
  main.innerHTML = `<h1>Offsite Reports</h1><p class="subtitle">Loading…</p>`;

  let projects, myReports, pendingReports;
  try {
    projects = await api('/portfolio');
    myReports = await api('/reports/mine');
    pendingReports = (state.me.isAdmin || state.me.isManager) ? await api('/reports/pending') : [];
  } catch (e) {
    main.innerHTML = `<h1>Offsite Reports</h1><p class="error-text">${escapeHtml(e.message)}</p>`;
    return;
  }

  const projectOptions = projects.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');

  const pendingSectionHtml = (state.me.isAdmin || state.me.isManager) ? `
    <div class="card">
      <h2>Pending Draft Reports</h2>
      <p class="hint">Review the AI-drafted report, edit if needed, then approve.</p>
      ${pendingReports.length === 0
        ? emptyStateHtml('No draft reports waiting for review.')
        : `<table>
            <thead><tr><th>Project</th><th>Submitted By</th><th>Date</th><th>Photos</th><th></th></tr></thead>
            <tbody>
              ${pendingReports.map(r => `
                <tr>
                  <td>${escapeHtml(r.project ? r.project.name : '—')}</td>
                  <td>${escapeHtml(r.submitter ? r.submitter.name : '—')}</td>
                  <td>${formatDate(r.createdAt.slice(0, 10))}</td>
                  <td>${r.photoUrls.length}</td>
                  <td><button class="btn small" data-review="${r.id}">Review</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>`}
    </div>
  ` : '';

  const mineSectionHtml = `
    <div class="card">
      <h2>My Submitted Reports</h2>
      ${myReports.length === 0
        ? emptyStateHtml('You haven\'t submitted any offsite reports yet.')
        : `<table>
            <thead><tr><th>Project</th><th>Date</th><th>Status</th><th></th></tr></thead>
            <tbody>
              ${myReports.map(r => `
                <tr>
                  <td>${escapeHtml(r.project ? r.project.name : '—')}</td>
                  <td>${formatDate(r.createdAt.slice(0, 10))}</td>
                  <td>${reportStatusBadge(r.status)}</td>
                  <td><button class="btn small secondary" data-view="${r.id}">View</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>`}
    </div>
  `;

  main.innerHTML = `
    <h1>Offsite Reports</h1>
    <p class="subtitle">Record a voice note from the field, attach photos, and get an AI-organized draft report for a project manager to review and approve.</p>

    <div class="card">
      <h2>New Offsite Report</h2>
      <form id="report-form">
        <div>
          <label>Project</label>
          <select name="projectId" required>${projectOptions}</select>
        </div>

        <div>
          <label>Voice Note</label>
          <div style="display:flex; align-items:center; gap:0.6rem; flex-wrap:wrap;">
            <button type="button" class="btn secondary" id="record-toggle">Start Recording</button>
            <span class="hint">or</span>
            <input type="file" id="audio-file-input" accept="audio/*" />
          </div>
          <div id="record-status" class="hint" style="margin-top:0.35rem;">No voice note captured yet.</div>
        </div>

        <div>
          <label>Photos (optional)</label>
          <input type="file" id="photos-input" accept="image/*" multiple />
        </div>

        <div id="report-form-error" class="error-text"></div>
        <div id="report-form-status" class="hint"></div>
        <button class="btn" type="submit" id="report-submit-btn">Submit Report</button>
      </form>
    </div>

    ${pendingSectionHtml}
    ${mineSectionHtml}
    <div id="report-modal-root"></div>
  `;

  // --- recording ---
  let recordedBlob = null;
  let mediaRecorder = null;
  let recordedChunks = [];
  const recordBtn = main.querySelector('#record-toggle');
  const recordStatus = main.querySelector('#record-status');
  const audioFileInput = main.querySelector('#audio-file-input');

  recordBtn.addEventListener('click', async () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordedChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.addEventListener('dataavailable', (e) => {
        if (e.data.size > 0) recordedChunks.push(e.data);
      });
      mediaRecorder.addEventListener('stop', () => {
        recordedBlob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        stream.getTracks().forEach(t => t.stop());
        recordBtn.textContent = 'Start Recording';
        recordStatus.textContent = `Recording captured (${Math.round(recordedBlob.size / 1024)} KB). Ready to submit.`;
        audioFileInput.value = '';
      });
      mediaRecorder.start();
      recordBtn.textContent = 'Stop Recording';
      recordStatus.textContent = 'Recording…';
    } catch (err) {
      recordStatus.textContent = 'Could not access microphone: ' + err.message + '. You can upload an audio file instead.';
    }
  });

  audioFileInput.addEventListener('change', () => {
    if (audioFileInput.files[0]) {
      recordedBlob = null;
      recordStatus.textContent = `Selected file: ${audioFileInput.files[0].name}`;
    }
  });

  // --- submit ---
  main.querySelector('#report-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const errBox = form.querySelector('#report-form-error');
    const statusBox = form.querySelector('#report-form-status');
    const submitBtn = form.querySelector('#report-submit-btn');
    errBox.textContent = '';

    const audioBlob = recordedBlob || audioFileInput.files[0];
    if (!audioBlob) {
      errBox.textContent = 'Please record or upload a voice note before submitting.';
      return;
    }

    const formData = new FormData();
    formData.append('projectId', form.projectId.value);
    formData.append('audio', audioBlob, audioBlob.name || 'voice-note.webm');
    Array.from(main.querySelector('#photos-input').files).forEach(f => formData.append('photos', f));

    submitBtn.disabled = true;
    statusBox.textContent = 'Uploading and transcribing your voice note, then drafting the report — this can take a little while…';

    try {
      await apiUpload('/reports', formData);
      statusBox.textContent = '';
      renderOffsiteReports(main);
    } catch (err) {
      submitBtn.disabled = false;
      statusBox.textContent = '';
      errBox.textContent = err.message;
    }
  });

  main.querySelectorAll('[data-review]').forEach(el => {
    el.addEventListener('click', () => showReportModal(main, Number(el.dataset.review), true));
  });
  main.querySelectorAll('[data-view]').forEach(el => {
    el.addEventListener('click', () => showReportModal(main, Number(el.dataset.view), false));
  });
}

async function showReportModal(main, reportId, reviewable) {
  const modalRoot = main.querySelector('#report-modal-root');
  if (!modalRoot) return;

  let report;
  try {
    report = await api('/reports/' + reportId);
  } catch (e) {
    alert(e.message);
    return;
  }

  const photosHtml = report.photoUrls.length === 0
    ? '<p class="hint">No photos attached.</p>'
    : `<div style="display:flex; flex-wrap:wrap; gap:0.75rem;">${report.photoUrls.map(url => `
        <div style="width:140px;">
          <img data-photo-url="${escapeHtml(url)}" style="width:140px; height:140px; object-fit:cover; border-radius:6px; border:1px solid var(--border); background:var(--bg); display:block;" />
          <button type="button" class="btn small secondary" data-log-snag="${escapeHtml(url)}" style="width:100%; margin-top:0.35rem;">Log as Snag</button>
        </div>
      `).join('')}</div>`;

  const bodyHtml = reviewable ? `
    <label>Draft Report (editable)</label>
    <textarea id="report-edit-text" style="min-height:220px; font-family:inherit;">${escapeHtml(report.draftText)}</textarea>
    <details style="margin-top:0.6rem;"><summary class="hint">Raw transcript</summary><p class="hint">${escapeHtml(report.transcript)}</p></details>
  ` : `
    <label>Report</label>
    <div class="card" style="white-space:pre-wrap; font-size:0.9rem;">${escapeHtml(report.draftText)}</div>
  `;

  const actionsHtml = reviewable ? `
    <div style="display:flex; gap:0.6rem; margin-top:1rem;">
      <button class="btn secondary" id="report-save-btn">Save Edits</button>
      <button class="btn" id="report-approve-btn">Approve</button>
    </div>
  ` : '';

  modalRoot.innerHTML = `
    <div class="modal-overlay" id="report-modal-overlay">
      <div class="modal-card" style="max-width:640px;">
        <button class="modal-close" id="report-modal-close">&times;</button>
        <h2>${escapeHtml(report.project ? report.project.name : 'Offsite Report')}</h2>
        ${reportStatusBadge(report.status)}
        <div class="modal-dates">
          <div><label>Date</label><div>${formatDate(report.createdAt.slice(0, 10))}</div></div>
          <div><label>Submitted By</label><div>${escapeHtml(report.submitter ? report.submitter.name : '—')}</div></div>
        </div>
        ${bodyHtml}
        <h3 style="margin-top:1rem;">Photos</h3>
        ${photosHtml}
        <h3 style="margin-top:1rem;">Voice Note</h3>
        ${report.audioUrl ? `<audio controls data-audio-url="${escapeHtml(report.audioUrl)}" style="width:100%;"></audio>` : '<p class="hint">No audio available.</p>'}
        <div id="report-modal-error" class="error-text"></div>
        ${actionsHtml}
      </div>
    </div>
  `;

  const overlay = document.getElementById('report-modal-overlay');
  const createdBlobUrls = [];
  const close = () => {
    modalRoot.innerHTML = '';
    createdBlobUrls.forEach(u => URL.revokeObjectURL(u));
  };
  document.getElementById('report-modal-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  modalRoot.querySelectorAll('[data-photo-url]').forEach(img => {
    authenticatedBlobUrl(img.dataset.photoUrl)
      .then(blobUrl => { createdBlobUrls.push(blobUrl); img.src = blobUrl; })
      .catch(() => { img.alt = 'Could not load photo'; });
  });
  modalRoot.querySelectorAll('[data-log-snag]').forEach(btn => {
    btn.addEventListener('click', () => {
      const photoUrl = btn.dataset.logSnag;
      state.pendingSnagFromReport = {
        mode: 'from-report',
        reportId: report.id,
        photoFileName: photoUrl.replace(/^\/uploads\//, ''),
        photoUrl,
        prefillDescription: report.draftText || ''
      };
      close();
      setView('project-snags', { projectId: report.projectId });
    });
  });
  const audioEl = modalRoot.querySelector('[data-audio-url]');
  if (audioEl) {
    authenticatedBlobUrl(audioEl.dataset.audioUrl)
      .then(blobUrl => { createdBlobUrls.push(blobUrl); audioEl.src = blobUrl; })
      .catch(() => { audioEl.replaceWith(document.createTextNode('Could not load audio.')); });
  }

  if (reviewable) {
    const errBox = document.getElementById('report-modal-error');
    document.getElementById('report-save-btn').addEventListener('click', async () => {
      try {
        await api('/reports/' + reportId, {
          method: 'PATCH',
          body: JSON.stringify({ draftText: document.getElementById('report-edit-text').value })
        });
        close();
        renderOffsiteReports(main);
      } catch (err) {
        errBox.textContent = err.message;
      }
    });
    document.getElementById('report-approve-btn').addEventListener('click', async () => {
      try {
        await api('/reports/' + reportId, {
          method: 'PATCH',
          body: JSON.stringify({ draftText: document.getElementById('report-edit-text').value, approve: true })
        });
        close();
        renderOffsiteReports(main);
      } catch (err) {
        errBox.textContent = err.message;
      }
    });
  }
}

start();
