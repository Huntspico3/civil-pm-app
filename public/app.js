const state = {
  gateToken: localStorage.getItem('civilpm_gate_token') || null,
  currentUserId: localStorage.getItem('civilpm_user_id') ? Number(localStorage.getItem('civilpm_user_id')) : null,
  users: [],
  roles: [],
  stages: [],
  view: 'dashboard', // 'dashboard' | 'projects' | 'project' | 'contacts' | 'team' | 'portfolio' | 'my-tasks' | 'offsite-reports'
  activeProjectId: null,
  dashboardGroupBy: 'project',
  myTasksUserId: null,
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
  if (state.currentUserId) headers['x-user-id'] = String(state.currentUserId);
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
  if (state.currentUserId) headers['x-user-id'] = String(state.currentUserId);
  const res = await fetch('/api' + path, { method: 'POST', headers, body: formData });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (data.gateRequired) requireGate();
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

function statusClass(status) {
  return 'status-' + status.replace(/\s+/g, '-');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
  state.users = await api('/users');
  if (state.currentUserId) {
    try {
      state.me = await api('/me');
    } catch (e) {
      state.currentUserId = null;
      localStorage.removeItem('civilpm_user_id');
    }
  }
  render();
}

// ---------------- SHARED PASSWORD GATE ----------------

function renderGateScreen(errorMessage) {
  root.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <h1>Civil <span style="color:#2563eb">PM</span></h1>
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

function login(userId) {
  state.currentUserId = userId;
  state.myTasksUserId = null;
  localStorage.setItem('civilpm_user_id', String(userId));
  boot();
}

function logout() {
  state.currentUserId = null;
  state.me = null;
  state.myTasksUserId = null;
  localStorage.removeItem('civilpm_user_id');
  render();
}

function setView(view, opts = {}) {
  state.view = view;
  if (opts.projectId !== undefined) state.activeProjectId = opts.projectId;
  render();
}

function render() {
  if (!state.currentUserId || !state.me) {
    root.innerHTML = renderLogin();
    bindLogin();
    return;
  }
  root.innerHTML = renderShell();
  bindShell();
}

// ---------------- LOGIN ----------------

function renderLogin() {
  const items = state.users.map(u => `
    <div class="user-pick" data-id="${u.id}">
      <div class="info">
        <strong>${escapeHtml(u.name)}</strong>
        <span class="email">${escapeHtml(u.email)}</span>
      </div>
      <div>
        ${u.isAdmin ? '<span class="badge admin">Admin</span> ' : ''}
        <span class="badge role-${u.role}">${u.role}</span>
      </div>
    </div>
  `).join('');

  return `
    <div class="login-wrap">
      <div class="login-card">
        <h1>Civil <span style="color:#2563eb">PM</span></h1>
        <p class="subtitle">Pick a team member to log in as (demo auth — no password for v1).</p>
        ${items}
      </div>
    </div>
  `;
}

function bindLogin() {
  root.querySelectorAll('.user-pick').forEach(el => {
    el.addEventListener('click', () => login(Number(el.dataset.id)));
  });
}

// ---------------- SHELL ----------------

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

  const navHtml = nav.map(n => `
    <button data-nav="${n.key}" class="${state.view === n.key || (n.key === 'projects' && state.view === 'project') ? 'active' : ''}">${n.label}</button>
  `).join('');

  return `
    <div class="topbar">
      <div class="brand">Civil <span>PM</span></div>
      <nav>${navHtml}</nav>
      <div class="who">
        <span class="badge role-${state.me.role}">${state.me.role}</span>
        ${state.me.isAdmin ? '<span class="badge admin">Admin</span>' : ''}
        <span class="name">${escapeHtml(state.me.name)}</span>
        <button class="switch" id="switch-user">Switch user</button>
      </div>
    </div>
    <main id="main-content"></main>
  `;
}

function bindShell() {
  root.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', () => setView(el.dataset.nav));
  });
  root.querySelector('#switch-user').addEventListener('click', logout);

  const main = root.querySelector('#main-content');
  if (state.view === 'dashboard') renderDashboard(main);
  else if (state.view === 'projects') renderProjects(main);
  else if (state.view === 'project') renderProjectDetail(main, state.activeProjectId);
  else if (state.view === 'contacts') renderContacts(main);
  else if (state.view === 'external-contacts') renderExternalContacts(main);
  else if (state.view === 'team') renderTeam(main);
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
      <td><span class="badge role-${u.role}">${u.role}</span></td>
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
    ? `<tr><td colspan="6" class="empty-state">No external contacts yet.</td></tr>`
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

async function renderDashboard(main) {
  main.innerHTML = `<h1>Dashboard</h1><p class="subtitle">Loading…</p>`;
  let tasks;
  try {
    tasks = await api('/dashboard');
  } catch (e) {
    main.innerHTML = `<h1>Dashboard</h1><p class="error-text">${escapeHtml(e.message)}</p>`;
    return;
  }

  const groupBy = state.dashboardGroupBy;
  const groups = new Map();
  tasks.forEach(t => {
    const key = groupBy === 'project'
      ? (t.project ? t.project.name : 'Unknown project')
      : (t.assignee ? t.assignee.name : 'Unassigned');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  });

  const groupsHtml = tasks.length === 0
    ? `<p class="empty-state">No tasks to show yet.</p>`
    : Array.from(groups.entries()).map(([key, list]) => `
        <div class="group-title">${escapeHtml(key)}</div>
        <div class="card">
          <table>
            <thead><tr><th>Task</th><th>Project</th><th>Role</th><th>Assignee</th><th>Status</th></tr></thead>
            <tbody>
              ${list.map(t => `
                <tr>
                  <td>${escapeHtml(t.title)}</td>
                  <td>${escapeHtml(t.project ? t.project.name : '—')}</td>
                  <td><span class="badge role-${t.requiredRole}">${t.requiredRole}</span></td>
                  <td>${t.assignee ? escapeHtml(t.assignee.name) : '<span class="hint">Unassigned</span>'}</td>
                  <td><span class="status ${statusClass(t.status)}">${t.status}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `).join('');

  main.innerHTML = `
    <h1>Dashboard</h1>
    <p class="subtitle">${state.me.isAdmin ? 'All projects and tasks across the org.' : 'Tasks assigned to you (and any projects you created).'}</p>
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
}

// ---------------- MY TASKS ----------------

async function renderMyTasks(main) {
  if (state.myTasksUserId === null) state.myTasksUserId = state.me.id;

  main.innerHTML = `<h1>My Tasks</h1><p class="subtitle">Loading…</p>`;
  let data;
  try {
    data = await api('/my-tasks?userId=' + state.myTasksUserId);
  } catch (e) {
    main.innerHTML = `<h1>My Tasks</h1><p class="error-text">${escapeHtml(e.message)}</p>`;
    return;
  }

  const { user, tasks } = data;

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

  const groups = new Map();
  tasks.forEach(t => {
    const key = t.project ? t.project.name : 'Unknown project';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  });

  const groupsHtml = tasks.length === 0
    ? `<p class="empty-state">${escapeHtml(user.name)} has no assigned tasks.</p>`
    : Array.from(groups.entries()).map(([projectName, list]) => `
        <div class="group-title">${escapeHtml(projectName)}</div>
        <div class="card">
          <table>
            <thead><tr><th>Task</th><th>Required Role</th><th>Status</th></tr></thead>
            <tbody>
              ${list.map(t => `
                <tr>
                  <td>${escapeHtml(t.title)}</td>
                  <td><span class="badge role-${t.requiredRole}">${t.requiredRole}</span></td>
                  <td><span class="status ${statusClass(t.status)}">${t.status}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `).join('');

  main.innerHTML = `
    <h1>My Tasks</h1>
    <p class="subtitle">${state.me.isAdmin ? `Tasks assigned to ${escapeHtml(user.name)}, across every project.` : 'Everything assigned to you, across every project.'}</p>
    ${pickerHtml}
    ${groupsHtml}
  `;

  const picker = main.querySelector('#my-tasks-user-picker');
  if (picker) {
    picker.addEventListener('change', () => {
      state.myTasksUserId = Number(picker.value);
      renderMyTasks(main);
    });
  }
}

// ---------------- PROJECTS ----------------

async function renderProjects(main) {
  main.innerHTML = `<h1>Projects</h1><p class="subtitle">Loading…</p>`;
  let projects;
  try {
    projects = await api('/projects');
  } catch (e) {
    main.innerHTML = `<h1>Projects</h1><p class="error-text">${escapeHtml(e.message)}</p>`;
    return;
  }

  const cardsHtml = projects.length === 0
    ? `<p class="empty-state">No projects visible to you yet.</p>`
    : `<div class="grid">${projects.map(p => `
        <div class="card project-card" data-project="${p.id}">
          <h3>${escapeHtml(p.name)}</h3>
          <p>${escapeHtml(p.description || 'No description')}</p>
          <div class="meta">
            <span class="badge stage-${p.stage}">${p.stage}</span>
            <span>${p.taskCount} task${p.taskCount === 1 ? '' : 's'}</span>
            <span>${p.myTaskCount} assigned to you</span>
          </div>
        </div>
      `).join('')}</div>`;

  const stageOptions = state.stages.map(s => `<option value="${s}">${s}</option>`).join('');

  main.innerHTML = `
    <div class="section-header">
      <div>
        <h1>Projects</h1>
        <p class="subtitle">${state.me.isAdmin ? 'All projects.' : 'Projects you created or have tasks in.'}</p>
      </div>
    </div>
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
    ${cardsHtml}
  `;

  main.querySelectorAll('[data-project]').forEach(el => {
    el.addEventListener('click', () => setView('project', { projectId: Number(el.dataset.project) }));
  });

  main.querySelector('#new-project-form').addEventListener('submit', async (e) => {
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

// ---------------- PROJECT DETAIL ----------------

async function renderProjectDetail(main, projectId) {
  main.innerHTML = `<p class="subtitle">Loading…</p>`;
  let project, tasks, fieldReports;
  try {
    project = await api('/projects/' + projectId);
    tasks = await api('/projects/' + projectId + '/tasks');
    fieldReports = await api('/projects/' + projectId + '/reports');
  } catch (e) {
    main.innerHTML = `<button class="back-link" id="back-to-projects">&larr; Back to Projects</button><p class="error-text">${escapeHtml(e.message)}</p>`;
    main.querySelector('#back-to-projects').addEventListener('click', () => setView('projects'));
    return;
  }

  const isManager = state.me.isAdmin || project.createdBy === state.me.id;

  const roleOptions = state.roles.map(r => `<option value="${r}">${r}</option>`).join('');

  function assigneeOptionsForRole(role, selectedId) {
    const matching = state.users.filter(u => u.role === role);
    const others = state.users.filter(u => u.role !== role);
    const sel = (id) => (selectedId != null && Number(selectedId) === id) ? ' selected' : '';
    let html = `<option value=""${selectedId == null ? ' selected' : ''}>— Unassigned —</option>`;
    if (matching.length) {
      html += `<optgroup label="Suggested (${role})">` +
        matching.map(u => `<option value="${u.id}"${sel(u.id)}>${escapeHtml(u.name)}</option>`).join('') +
        `</optgroup>`;
    }
    if (others.length) {
      html += `<optgroup label="Other team members">` +
        others.map(u => `<option value="${u.id}"${sel(u.id)}>${escapeHtml(u.name)} (${u.role})</option>`).join('') +
        `</optgroup>`;
    }
    return html;
  }

  const taskRows = tasks.length === 0
    ? `<tr><td colspan="5" class="empty-state">No tasks yet.</td></tr>`
    : tasks.map(t => {
        const canReassign = isManager;
        const canChangeStatus = isManager || t.assigneeId === state.me.id;
        return `
          <tr data-task="${t.id}">
            <td>
              <strong>${escapeHtml(t.title)}</strong>
              ${t.description ? `<div class="hint">${escapeHtml(t.description)}</div>` : ''}
            </td>
            <td><span class="badge role-${t.requiredRole}">${t.requiredRole}</span></td>
            <td>
              ${canReassign
                ? `<select class="select-inline" data-action="reassign" data-task="${t.id}">${assigneeOptionsForRole(t.requiredRole, t.assigneeId)}</select>`
                : (t.assignee ? escapeHtml(t.assignee.name) : '<span class="hint">Unassigned</span>')}
            </td>
            <td>
              ${canChangeStatus
                ? `<select class="select-inline" data-action="status" data-task="${t.id}">
                    ${['To Do', 'In Progress', 'Done'].map(s => `<option value="${s}" ${s === t.status ? 'selected' : ''}>${s}</option>`).join('')}
                  </select>`
                : `<span class="status ${statusClass(t.status)}">${t.status}</span>`}
            </td>
          </tr>
        `;
      }).join('');

  main.innerHTML = `
    <button class="back-link" id="back-to-projects">&larr; Back to Projects</button>
    <h1>${escapeHtml(project.name)}</h1>
    <p class="subtitle">${escapeHtml(project.description || '')}</p>

    <div class="card">
      <h2>Tasks</h2>
      <table>
        <thead><tr><th>Task</th><th>Role</th><th>Assignee</th><th>Status</th></tr></thead>
        <tbody>${taskRows}</tbody>
      </table>
    </div>

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
            <select name="assigneeId" id="assignee-select">${assigneeOptionsForRole(state.roles[0])}</select>
            <div class="hint">Suggestions are matched to the required role above.</div>
          </div>
        </div>
        <div id="task-form-error" class="error-text"></div>
        <button class="btn" type="submit">Create Task</button>
      </form>
    </div>

    <div class="card">
      <h2>Field Reports</h2>
      ${fieldReports.length === 0
        ? '<p class="empty-state">No approved offsite reports for this project yet.</p>'
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
  `;

  main.querySelector('#back-to-projects').addEventListener('click', () => setView('projects'));

  main.querySelectorAll('[data-view-report]').forEach(el => {
    el.addEventListener('click', () => showReportModal(main, Number(el.dataset.viewReport), false));
  });

  const roleSelect = main.querySelector('#required-role-select');
  const assigneeSelect = main.querySelector('#assignee-select');
  roleSelect.addEventListener('change', () => {
    assigneeSelect.innerHTML = assigneeOptionsForRole(roleSelect.value);
  });

  main.querySelectorAll('[data-action="reassign"]').forEach(el => {
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

  main.querySelector('#new-task-form').addEventListener('submit', async (e) => {
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
          assigneeId: form.assigneeId.value || null
        })
      });
      renderProjectDetail(main, projectId);
    } catch (err) {
      errBox.textContent = err.message;
    }
  });
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

  const roleOptions = state.roles.map(r => `<option value="${r}">${r}</option>`).join('');

  const rows = users.map(u => `
    <tr>
      <td>${escapeHtml(u.name)}</td>
      <td>${escapeHtml(u.email)}</td>
      <td>${u.phone ? escapeHtml(u.phone) : '<span class="hint">—</span>'}</td>
      <td><span class="badge role-${u.role}">${u.role}</span></td>
      <td>${u.isAdmin ? '<span class="badge admin">Admin</span>' : ''}</td>
    </tr>
  `).join('');

  main.innerHTML = `
    <h1>Team</h1>
    <p class="subtitle">Invite team members and see everyone's engineering role.</p>

    <div class="card">
      <h2>Invite Team Member</h2>
      <p class="hint">v1: this creates their account directly (no email is actually sent yet).</p>
      <form id="invite-form">
        <div class="form-row">
          <div><label>Name</label><input name="name" required placeholder="Full name" /></div>
          <div><label>Email</label><input name="email" type="email" required placeholder="name@company.com" /></div>
          <div><label>Phone</label><input name="phone" type="tel" placeholder="555-0100" /></div>
          <div><label>Role</label><select name="role">${roleOptions}</select></div>
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
        body: JSON.stringify({ name: form.name.value, email: form.email.value, phone: form.phone.value, role: form.role.value })
      });
      state.users = await api('/users');
      renderTeam(main);
    } catch (err) {
      errBox.textContent = err.message;
    }
  });
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
    main.innerHTML = `<h1>Portfolio Timeline</h1><p class="empty-state">No projects yet.</p>`;
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
    return `
      <div class="gantt-row">
        <div class="gantt-label">
          <div>${escapeHtml(p.name)}</div>
          <span class="badge stage-${p.stage}">${p.stage}</span>
        </div>
        <div class="gantt-track">
          <div class="gantt-bar stage-${p.stage}" data-project="${p.id}" style="left:${left}%; width:${width}%;" title="${escapeHtml(p.name)}">
            ${escapeHtml(p.name)}
          </div>
        </div>
      </div>
    `;
  }).join('');

  const ticksHtml = ticks.map(t => `<div class="gantt-tick" style="left:${t.left}%">${t.label}</div>`).join('');

  main.innerHTML = `
    <h1>Portfolio Timeline</h1>
    <p class="subtitle">All projects across the organisation. Click a bar to see project details.</p>
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

  main.querySelectorAll('.gantt-bar').forEach(el => {
    el.addEventListener('click', () => {
      const project = projects.find(p => p.id === Number(el.dataset.project));
      if (project) showProjectModal(project);
    });
  });
}

function showProjectModal(project) {
  const modalRoot = document.getElementById('portfolio-modal-root');
  if (!modalRoot) return;

  const teamHtml = project.team.length === 0
    ? `<p class="hint">No team members assigned yet.</p>`
    : `<ul class="modal-team-list">${project.team.map(u => `
        <li>
          <span>${escapeHtml(u.name)}</span>
          <span class="badge role-${u.role}">${u.role}</span>
        </li>
      `).join('')}</ul>`;

  modalRoot.innerHTML = `
    <div class="modal-overlay" id="project-modal-overlay">
      <div class="modal-card">
        <button class="modal-close" id="project-modal-close">&times;</button>
        <h2>${escapeHtml(project.name)}</h2>
        <span class="badge stage-${project.stage}">${project.stage}</span>
        <p class="subtitle">${escapeHtml(project.description || '')}</p>
        <div class="modal-dates">
          <div><label>Start Date</label><div>${formatDate(project.startDate)}</div></div>
          <div><label>End Date</label><div>${formatDate(project.endDate)}</div></div>
        </div>
        <h3>Assigned Team Members</h3>
        ${teamHtml}
      </div>
    </div>
  `;

  const overlay = document.getElementById('project-modal-overlay');
  const close = () => { modalRoot.innerHTML = ''; };
  document.getElementById('project-modal-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
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
        ? '<p class="empty-state">No draft reports waiting for review.</p>'
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
        ? '<p class="empty-state">You haven\'t submitted any offsite reports yet.</p>'
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
    : `<div style="display:flex; flex-wrap:wrap; gap:0.5rem;">${report.photoUrls.map(url => `<img src="${url}" style="max-width:140px; max-height:140px; border-radius:6px; border:1px solid var(--border);" />`).join('')}</div>`;

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
        ${report.audioUrl ? `<audio controls src="${report.audioUrl}" style="width:100%;"></audio>` : '<p class="hint">No audio available.</p>'}
        <div id="report-modal-error" class="error-text"></div>
        ${actionsHtml}
      </div>
    </div>
  `;

  const overlay = document.getElementById('report-modal-overlay');
  const close = () => { modalRoot.innerHTML = ''; };
  document.getElementById('report-modal-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

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
