const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const db = require('./db');
const ai = require('./ai');
const email = require('./email');
const auth = require('./auth');
const fileValidation = require('./fileValidation');

const UPLOADS_DIR = path.join(db.DATA_DIR, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname || ''))
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'audio' && !file.mimetype.startsWith('audio/')) {
      return cb(new Error('The audio field must be an audio file'));
    }
    if (file.fieldname === 'photos' && !file.mimetype.startsWith('image/')) {
      return cb(new Error('Photo attachments must be image files'));
    }
    cb(null, true);
  }
});

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- shared trial gate: one shared password required before the individual login screen ---
// Tokens are kept in memory only, so everyone is asked for the password again after a server restart.
const gateTokens = new Set();

app.post('/api/gate/verify', (req, res) => {
  const configuredPassword = process.env.TRIAL_PASSWORD;
  if (!configuredPassword) {
    return res.status(500).json({ error: 'TRIAL_PASSWORD is not set on the server. Set it as an environment variable and restart the app.' });
  }
  const { password } = req.body;
  if (password !== configuredPassword) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  const token = crypto.randomUUID();
  gateTokens.add(token);
  res.json({ token });
});

function requireGateToken(req, res, next) {
  const token = req.headers['x-gate-token'];
  if (!token || !gateTokens.has(token)) {
    return res.status(401).json({ error: 'Shared password required', gateRequired: true });
  }
  next();
}

app.use('/api', (req, res, next) => {
  if (req.path === '/gate/verify') return next();
  requireGateToken(req, res, next);
});

// --- auth: identity comes from a server-issued session token, never a client-claimed id ---
function attachUser(req, res, next) {
  const token = req.headers['x-session-token'];
  const session = auth.getSession(token);
  if (session) {
    const data = db.load();
    const user = data.users.find(u => u.id === session.userId);
    if (user) req.user = user;
  }
  next();
}
app.use(attachUser);

// Uploaded photos/audio are real user content, not part of the public app
// shell — require the same shared-password gate and a logged-in session
// before serving any of them, same as every other piece of app data.
app.use('/uploads', requireGateToken, (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  next();
}, express.static(UPLOADS_DIR));

app.post('/api/login', (req, res) => {
  const { email: rawEmail, password } = req.body;
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const data = db.load();
  const user = data.users.find(u => u.email.toLowerCase() === email);
  const credential = user ? data.userCredentials.find(c => c.userId === user.id) : null;

  // Same generic message whether the email doesn't exist or the password is
  // wrong, so a failed attempt doesn't reveal which one was incorrect.
  if (!user || !credential || !auth.verifyPassword(password, credential.passwordHash)) {
    return res.status(401).json({ error: 'Incorrect email or password' });
  }

  const token = auth.createSession(user.id);
  res.json({ token, user });
});

app.post('/api/logout', (req, res) => {
  auth.destroySession(req.headers['x-session-token']);
  res.json({ ok: true });
});

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) return res.status(403).json({ error: 'Admin access required' });
  next();
}

// A "manager" is an admin, or anyone who has created at least one project
// (project creators act as that project's manager/director elsewhere in the app).
function isManager(user, data) {
  return user.isAdmin || data.projects.some(p => p.createdBy === user.id);
}

function requireManager(req, res, next) {
  const data = db.load();
  if (!req.user || !isManager(req.user, data)) {
    return res.status(403).json({ error: 'Admin or project manager access required' });
  }
  next();
}

// Can this user see this project?
function canSeeProject(user, project, tasks) {
  if (user.isAdmin) return true;
  if (project.createdBy === user.id) return true;
  return tasks.some(t => t.projectId === project.id && t.assigneeId === user.id);
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Renames an already-uploaded file on disk (and updates the multer file object
// in place) so its extension matches its actual detected content type.
function enforceDetectedExtension(file, detectedExt) {
  const currentExt = path.extname(file.filename);
  if (currentExt.toLowerCase() === detectedExt) return;
  const newFilename = path.basename(file.filename, currentExt) + detectedExt;
  const newPath = path.join(path.dirname(file.path), newFilename);
  fs.renameSync(file.path, newPath);
  file.filename = newFilename;
  file.path = newPath;
}

// Progress is computed live from task statuses rather than cached, so a task
// status change anywhere in the app is reflected the next time progress is read
// — no event wiring needed. The last entry in data.taskStatuses (the rightmost
// Kanban column) is treated as "done", so this still works if an admin renames it.
function computeAutoProgress(projectId, data) {
  const projectTasks = data.tasks.filter(t => t.projectId === projectId);
  if (projectTasks.length === 0) return { progress: 0, done: 0, total: 0 };
  const doneStatus = data.taskStatuses[data.taskStatuses.length - 1];
  const done = projectTasks.filter(t => t.status === doneStatus).length;
  return { progress: Math.round((done / projectTasks.length) * 100), done, total: projectTasks.length };
}

// A project stays on auto-calculated progress until a user drags its bar (or
// types a value) to set a manual override; that override sticks until they
// explicitly reset it back to automatic — a task status change alone does not
// clear it, so a deliberate override isn't silently undone by routine work.
function withComputedProgress(project, data) {
  const auto = computeAutoProgress(project.id, data);
  const progress = project.progressMode === 'manual' ? project.progress : auto.progress;
  return { ...project, progress, taskProgress: { done: auto.done, total: auto.total } };
}

// --- admin-editable option lists (roles, stages, task statuses, external contact
// categories) — all managed the same way from the Settings page. `usageParts`
// returns human-readable counts of what currently uses a given option, so removal
// can be blocked with a clear message instead of silently breaking existing data.
function registerOptionList(path, getList, usageParts) {
  app.get(path, (req, res) => res.json(getList(db.load())));

  app.post(path, requireAdmin, (req, res) => {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const data = db.load();
    const list = getList(data);
    if (list.some(v => v.toLowerCase() === name.toLowerCase())) {
      return res.status(400).json({ error: 'That option already exists' });
    }
    list.push(name);
    db.save(data);
    res.status(201).json(list);
  });

  app.delete(path, requireAdmin, (req, res) => {
    const name = (req.body.name || '').trim();
    const data = db.load();
    const list = getList(data);
    if (!list.includes(name)) return res.status(404).json({ error: 'Option not found' });

    const parts = usageParts(data, name);
    if (parts.length > 0) {
      return res.status(400).json({ error: `Cannot remove "${name}" — it's still used by ${parts.join(' and ')}.` });
    }

    list.splice(list.indexOf(name), 1);
    db.save(data);
    res.json(list);
  });
}

function countPart(count, label) {
  return count > 0 ? [`${count} ${label}${count === 1 ? '' : 's'}`] : [];
}

registerOptionList('/api/roles', (data) => data.roles, (data, name) => [
  ...countPart(data.users.filter(u => u.role === name).length, 'team member'),
  ...countPart(data.tasks.filter(t => t.requiredRole === name).length, 'task')
]);

registerOptionList('/api/stages', (data) => data.stages, (data, name) =>
  countPart(data.projects.filter(p => p.stage === name).length, 'project')
);

registerOptionList('/api/task-statuses', (data) => data.taskStatuses, (data, name) =>
  countPart(data.tasks.filter(t => t.status === name).length, 'task')
);

registerOptionList('/api/external-contact-categories', (data) => data.externalContactCategories, (data, name) =>
  countPart(data.externalContacts.filter(c => c.category === name).length, 'external contact')
);

// --- session ---
app.get('/api/me', requireAuth, (req, res) => {
  const data = db.load();
  res.json({ ...req.user, isManager: isManager(req.user, data) });
});

// --- users ---
app.get('/api/users', (req, res) => {
  const data = db.load();
  res.json(data.users);
});

app.post('/api/users', requireAdmin, (req, res) => {
  const { name, email, phone, role, password } = req.body;
  if (!name || !email || !role || !password) {
    return res.status(400).json({ error: 'name, email, role, and password are required' });
  }
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const data = db.load();
  if (!data.roles.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (data.users.some(u => u.email.toLowerCase() === String(email).toLowerCase())) {
    return res.status(400).json({ error: 'A user with that email already exists' });
  }
  const user = { id: db.nextId('user'), name, email, phone: phone || '', role, isAdmin: false };
  data.users.push(user);
  data.userCredentials.push({ userId: user.id, passwordHash: auth.hashPassword(password) });
  db.save(data);
  res.status(201).json(user);
});

// --- projects ---
app.get('/api/projects', requireAuth, (req, res) => {
  const data = db.load();
  const visible = data.projects.filter(p => canSeeProject(req.user, p, data.tasks));
  const withCounts = visible.map(p => {
    const tasks = data.tasks.filter(t => t.projectId === p.id);
    return {
      ...withComputedProgress(p, data),
      taskCount: tasks.length,
      myTaskCount: tasks.filter(t => t.assigneeId === req.user.id).length
    };
  });
  res.json(withCounts);
});

app.post('/api/projects', requireAuth, (req, res) => {
  const { name, description, startDate, endDate, stage, color, progress } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (color !== undefined && !HEX_COLOR_RE.test(color)) return res.status(400).json({ error: 'Color must be a hex value like #2563eb' });
  if (progress !== undefined && (typeof progress !== 'number' || progress < 0 || progress > 100)) {
    return res.status(400).json({ error: 'Progress must be a number between 0 and 100' });
  }

  const data = db.load();
  if (stage && !data.stages.includes(stage)) return res.status(400).json({ error: 'Invalid stage' });

  const today = new Date();
  const defaultStart = today.toISOString().slice(0, 10);
  const defaultEnd = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const project = {
    id: db.nextId('project'),
    name,
    description: description || '',
    createdBy: req.user.id,
    startDate: startDate || defaultStart,
    endDate: endDate || defaultEnd,
    stage: stage || data.stages[0],
    color: color || db.PROJECT_COLOR_PALETTE[data.projects.length % db.PROJECT_COLOR_PALETTE.length],
    progress: progress !== undefined ? progress : 0,
    progressMode: progress !== undefined ? 'manual' : 'auto'
  };
  data.projects.push(project);
  db.save(data);
  res.status(201).json(withComputedProgress(project, data));
});

app.get('/api/projects/:id', requireAuth, (req, res) => {
  const data = db.load();
  const project = data.projects.find(p => p.id === Number(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!canSeeProject(req.user, project, data.tasks)) return res.status(403).json({ error: 'Not visible to you' });
  res.json(withComputedProgress(project, data));
});

app.patch('/api/projects/:id', requireAuth, (req, res) => {
  const data = db.load();
  const project = data.projects.find(p => p.id === Number(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const canEdit = req.user.isAdmin || project.createdBy === req.user.id;
  if (!canEdit) return res.status(403).json({ error: 'Only an admin or this project\'s creator can edit it' });

  const { color, progress, progressMode, startDate, endDate } = req.body;
  if (color !== undefined) {
    if (!HEX_COLOR_RE.test(color)) return res.status(400).json({ error: 'Color must be a hex value like #2563eb' });
    project.color = color;
  }
  if (progress !== undefined) {
    if (typeof progress !== 'number' || progress < 0 || progress > 100) {
      return res.status(400).json({ error: 'Progress must be a number between 0 and 100' });
    }
    project.progress = progress;
    project.progressMode = 'manual';
  }
  if (progressMode !== undefined) {
    if (progressMode !== 'auto' && progressMode !== 'manual') {
      return res.status(400).json({ error: 'progressMode must be "auto" or "manual"' });
    }
    project.progressMode = progressMode;
  }
  if (startDate !== undefined || endDate !== undefined) {
    const nextStart = startDate !== undefined ? startDate : project.startDate;
    const nextEnd = endDate !== undefined ? endDate : project.endDate;
    if (!DATE_RE.test(nextStart) || !DATE_RE.test(nextEnd)) {
      return res.status(400).json({ error: 'Dates must be in YYYY-MM-DD format' });
    }
    if (nextStart >= nextEnd) {
      return res.status(400).json({ error: 'Start date must be before end date' });
    }
    project.startDate = nextStart;
    project.endDate = nextEnd;
  }

  db.save(data);
  res.json(withComputedProgress(project, data));
});

// --- tasks ---
app.get('/api/projects/:id/tasks', requireAuth, (req, res) => {
  const data = db.load();
  const project = data.projects.find(p => p.id === Number(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!canSeeProject(req.user, project, data.tasks)) return res.status(403).json({ error: 'Not visible to you' });

  const isFullAccess = req.user.isAdmin || project.createdBy === req.user.id;
  let tasks = data.tasks.filter(t => t.projectId === project.id);
  if (!isFullAccess) tasks = tasks.filter(t => t.assigneeId === req.user.id);

  const withAssignee = tasks.map(t => ({
    ...t,
    assignee: data.users.find(u => u.id === t.assigneeId) || null
  }));
  res.json(withAssignee);
});

app.post('/api/projects/:id/tasks', requireAuth, (req, res) => {
  const data = db.load();
  const project = data.projects.find(p => p.id === Number(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!canSeeProject(req.user, project, data.tasks)) return res.status(403).json({ error: 'Not visible to you' });

  const { title, description, requiredRole, assigneeId } = req.body;
  if (!title || !requiredRole) return res.status(400).json({ error: 'title and requiredRole are required' });
  if (!data.roles.includes(requiredRole)) return res.status(400).json({ error: 'Invalid role' });

  const isManager = req.user.isAdmin || project.createdBy === req.user.id;
  const targetAssigneeId = assigneeId ? Number(assigneeId) : null;
  if (!isManager && targetAssigneeId !== null && targetAssigneeId !== req.user.id) {
    return res.status(403).json({ error: 'Only an admin or this project\'s manager can assign tasks to other team members — you can assign it to yourself instead.' });
  }

  let assignee = null;
  if (targetAssigneeId !== null) {
    assignee = data.users.find(u => u.id === targetAssigneeId);
    if (!assignee) return res.status(400).json({ error: 'Assignee not found' });
  }

  const task = {
    id: db.nextId('task'),
    projectId: project.id,
    title,
    description: description || '',
    requiredRole,
    assigneeId: assignee ? assignee.id : null,
    status: data.taskStatuses[0]
  };
  data.tasks.push(task);
  db.save(data);
  res.status(201).json({ ...task, assignee });
});

app.patch('/api/tasks/:id', requireAuth, (req, res) => {
  const data = db.load();
  const task = data.tasks.find(t => t.id === Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const project = data.projects.find(p => p.id === task.projectId);
  const isManager = req.user.isAdmin || project.createdBy === req.user.id;
  const isAssignee = task.assigneeId === req.user.id;
  const { assigneeId, status, title, description, requiredRole } = req.body;

  // A non-manager may still assign a task to themselves (claiming unassigned
  // work), so that alone must be enough to pass the general edit gate below.
  const targetAssigneeId = assigneeId === undefined ? undefined : (assigneeId === null ? null : Number(assigneeId));
  const isSelfAssign = targetAssigneeId !== undefined && targetAssigneeId === req.user.id;

  if (!isManager && !isAssignee && !isSelfAssign) return res.status(403).json({ error: 'Not permitted to edit this task' });

  if (targetAssigneeId !== undefined) {
    if (!isManager && targetAssigneeId !== null && targetAssigneeId !== req.user.id) {
      return res.status(403).json({ error: 'Only an admin or this project\'s manager can assign this task to someone else — you can assign it to yourself instead.' });
    }
    if (targetAssigneeId === null) {
      task.assigneeId = null;
    } else {
      const assignee = data.users.find(u => u.id === targetAssigneeId);
      if (!assignee) return res.status(400).json({ error: 'Assignee not found' });
      task.assigneeId = assignee.id;
    }
  }
  if (status !== undefined) {
    if (!data.taskStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    task.status = status;
  }
  if (isManager && title !== undefined) task.title = title;
  if (isManager && description !== undefined) task.description = description;
  if (isManager && requiredRole !== undefined) {
    if (!data.roles.includes(requiredRole)) return res.status(400).json({ error: 'Invalid role' });
    task.requiredRole = requiredRole;
  }

  db.save(data);
  res.json({ ...task, assignee: data.users.find(u => u.id === task.assigneeId) || null });
});

// --- dashboard ---
app.get('/api/dashboard', requireAuth, (req, res) => {
  const data = db.load();
  const visibleProjects = data.projects.filter(p => canSeeProject(req.user, p, data.tasks));
  const visibleProjectIds = new Set(visibleProjects.map(p => p.id));

  let tasks = data.tasks.filter(t => visibleProjectIds.has(t.projectId));
  if (!req.user.isAdmin) {
    tasks = tasks.filter(t => {
      const project = data.projects.find(p => p.id === t.projectId);
      const isManager = project.createdBy === req.user.id;
      return isManager || t.assigneeId === req.user.id;
    });
  }

  const enriched = tasks.map(t => ({
    ...t,
    project: data.projects.find(p => p.id === t.projectId),
    assignee: data.users.find(u => u.id === t.assigneeId) || null
  }));

  res.json(enriched);
});

// --- dashboard summary stats: tailored to admin (org-wide) vs a regular member (their own) ---
app.get('/api/dashboard-stats', requireAuth, (req, res) => {
  const data = db.load();
  const doneStatus = data.taskStatuses[data.taskStatuses.length - 1];

  if (req.user.isAdmin) {
    const finalStage = data.stages[data.stages.length - 1];
    return res.json({
      role: 'admin',
      totalProjects: data.projects.length,
      activeProjects: data.projects.filter(p => p.stage !== finalStage).length,
      tasksAcrossTeam: data.tasks.length,
      openRfisOrgWide: data.rfis.filter(r => !r.answer).length
    });
  }

  const myTasks = data.tasks.filter(t => t.assigneeId === req.user.id);
  const myOpenRfis = data.rfis.filter(r => r.assignedTo === req.user.id && !r.answer);
  const soon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  res.json({
    role: 'member',
    myOpenTasks: myTasks.filter(t => t.status !== doneStatus).length,
    myOpenRfis: myOpenRfis.length,
    dueSoonOrOverdue: myOpenRfis.filter(r => r.dueDate <= soon).length
  });
});

// --- my tasks (a user's tasks across every project; admins can view any team member's) ---
app.get('/api/my-tasks', requireAuth, (req, res) => {
  const data = db.load();
  let targetUser = req.user;
  if (req.query.userId !== undefined) {
    if (Number(req.query.userId) !== req.user.id && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Only an admin can view another team member\'s tasks' });
    }
    const found = data.users.find(u => u.id === Number(req.query.userId));
    if (!found) return res.status(404).json({ error: 'User not found' });
    targetUser = found;
  }

  const tasks = data.tasks
    .filter(t => t.assigneeId === targetUser.id)
    .map(t => ({
      ...t,
      project: data.projects.find(p => p.id === t.projectId) || null
    }));

  res.json({ user: targetUser, tasks });
});

// --- external contacts (subcontractors, consultants, etc. — admins & project managers only) ---
app.get('/api/external-contacts', requireManager, (req, res) => {
  const data = db.load();
  const contacts = data.externalContacts.map(c => ({
    ...c,
    project: c.projectId ? data.projects.find(p => p.id === c.projectId) || null : null
  }));
  res.json(contacts);
});

// --- offsite reports (voice note + photos -> transcript -> AI-drafted report) ---

function enrichReport(report, data) {
  return {
    ...report,
    project: data.projects.find(p => p.id === report.projectId) || null,
    submitter: data.users.find(u => u.id === report.submittedBy) || null,
    reviewer: report.reviewedBy ? data.users.find(u => u.id === report.reviewedBy) || null : null,
    audioUrl: report.audioFile ? '/uploads/' + report.audioFile : null,
    photoUrls: report.photos.map(f => '/uploads/' + f)
  };
}

function canViewReport(user, report, data) {
  if (isManager(user, data)) return true;
  if (report.submittedBy === user.id) return true;
  if (report.status === 'approved') {
    const project = data.projects.find(p => p.id === report.projectId);
    return project && canSeeProject(user, project, data.tasks);
  }
  return false;
}

app.post('/api/reports', requireAuth, upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'photos', maxCount: 10 }]), async (req, res) => {
  const uploadedFiles = [
    ...(req.files.audio || []),
    ...(req.files.photos || [])
  ];
  const cleanup = () => uploadedFiles.forEach(f => fs.unlink(f.path, () => {}));

  try {
    const data = db.load();
    const projectId = Number(req.body.projectId);
    const project = data.projects.find(p => p.id === projectId);
    if (!project) {
      cleanup();
      return res.status(400).json({ error: 'Project not found' });
    }
    const audioFile = (req.files.audio || [])[0];
    if (!audioFile) {
      cleanup();
      return res.status(400).json({ error: 'A voice note (audio file) is required' });
    }
    const photoFiles = req.files.photos || [];

    // multer's fileFilter only trusts the browser-reported Content-Type, which
    // an attacker fully controls — check the actual file bytes before doing
    // anything else with what was uploaded. The stored extension is then
    // reset to match the *real* detected type, ignoring whatever extension
    // the uploaded filename claimed, so a dangerous extension (e.g. .html)
    // can never end up on disk even if the content happened to pass.
    const audioExt = fileValidation.detectAudioExt(audioFile.path);
    if (!audioExt) {
      cleanup();
      return res.status(400).json({ error: 'The uploaded audio file is not a recognized audio format.' });
    }
    enforceDetectedExtension(audioFile, audioExt);

    for (const photo of photoFiles) {
      const imageExt = fileValidation.detectImageExt(photo.path);
      if (!imageExt) {
        cleanup();
        return res.status(400).json({ error: 'One of the uploaded photos is not a recognized image format.' });
      }
      enforceDetectedExtension(photo, imageExt);
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    const transcript = await ai.transcribeAudio(audioFile.path, audioFile.mimetype);
    const draftText = await ai.generateDraftReport({
      transcript,
      projectName: project.name,
      submitterName: req.user.name,
      dateStr
    });

    const report = {
      id: db.nextId('report'),
      projectId: project.id,
      submittedBy: req.user.id,
      createdAt: new Date().toISOString(),
      audioFile: audioFile.filename,
      photos: photoFiles.map(f => f.filename),
      transcript,
      draftText,
      status: 'pending',
      reviewedBy: null,
      reviewedAt: null
    };
    data.reports.push(report);
    db.save(data);
    res.status(201).json(enrichReport(report, data));
  } catch (err) {
    cleanup();
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reports/pending', requireManager, (req, res) => {
  const data = db.load();
  const pending = data.reports
    .filter(r => r.status === 'pending')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(r => enrichReport(r, data));
  res.json(pending);
});

app.get('/api/reports/mine', requireAuth, (req, res) => {
  const data = db.load();
  const mine = data.reports
    .filter(r => r.submittedBy === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(r => enrichReport(r, data));
  res.json(mine);
});

app.get('/api/reports/:id', requireAuth, (req, res) => {
  const data = db.load();
  const report = data.reports.find(r => r.id === Number(req.params.id));
  if (!report) return res.status(404).json({ error: 'Report not found' });
  if (!canViewReport(req.user, report, data)) return res.status(403).json({ error: 'Not permitted to view this report' });
  res.json(enrichReport(report, data));
});

app.patch('/api/reports/:id', requireManager, (req, res) => {
  const data = db.load();
  const report = data.reports.find(r => r.id === Number(req.params.id));
  if (!report) return res.status(404).json({ error: 'Report not found' });

  const { draftText, approve } = req.body;
  if (draftText !== undefined) report.draftText = draftText;
  if (approve) {
    report.status = 'approved';
    report.reviewedBy = req.user.id;
    report.reviewedAt = new Date().toISOString();
  }

  db.save(data);
  res.json(enrichReport(report, data));
});

app.get('/api/projects/:id/reports', requireAuth, (req, res) => {
  const data = db.load();
  const project = data.projects.find(p => p.id === Number(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!canSeeProject(req.user, project, data.tasks)) return res.status(403).json({ error: 'Not visible to you' });

  const approved = data.reports
    .filter(r => r.projectId === project.id && r.status === 'approved')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(r => enrichReport(r, data));
  res.json(approved);
});

// --- RFIs (Requests for Information) ---

function enrichRfi(rfi, data) {
  const status = rfi.answer ? 'Answered' : 'Open';
  const today = new Date().toISOString().slice(0, 10);
  return {
    ...rfi,
    status,
    overdue: status === 'Open' && rfi.dueDate < today,
    assignee: data.users.find(u => u.id === rfi.assignedTo) || null,
    createdByUser: data.users.find(u => u.id === rfi.createdBy) || null
  };
}

app.get('/api/projects/:id/rfis', requireAuth, (req, res) => {
  const data = db.load();
  const project = data.projects.find(p => p.id === Number(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!canSeeProject(req.user, project, data.tasks)) return res.status(403).json({ error: 'Not visible to you' });

  const enriched = data.rfis
    .filter(r => r.projectId === project.id)
    .map(r => enrichRfi(r, data));

  // Most urgent first: overdue-open, then open (soonest due date), then answered (newest first).
  enriched.sort((a, b) => {
    const rank = (r) => r.overdue ? 0 : r.status === 'Open' ? 1 : 2;
    const rankDiff = rank(a) - rank(b);
    if (rankDiff !== 0) return rankDiff;
    if (a.status === 'Open') return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  res.json(enriched);
});

app.post('/api/projects/:id/rfis', requireAuth, (req, res) => {
  const data = db.load();
  const project = data.projects.find(p => p.id === Number(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!canSeeProject(req.user, project, data.tasks)) return res.status(403).json({ error: 'Not visible to you' });

  const { question, assignedTo, dueDate } = req.body;
  if (!question || !assignedTo || !dueDate) {
    return res.status(400).json({ error: 'question, assignedTo, and dueDate are required' });
  }
  const assignee = data.users.find(u => u.id === Number(assignedTo));
  if (!assignee) return res.status(400).json({ error: 'Assignee not found' });

  const rfi = {
    id: db.nextId('rfi'),
    projectId: project.id,
    question,
    assignedTo: assignee.id,
    dueDate,
    answer: null,
    createdBy: req.user.id,
    createdAt: new Date().toISOString(),
    answeredAt: null
  };
  data.rfis.push(rfi);
  db.save(data);
  res.status(201).json(enrichRfi(rfi, data));

  // Fire-and-forget: notification email should never delay or fail the response above.
  email.sendRfiAssignedEmail({
    to: assignee.email,
    toName: assignee.name,
    projectName: project.name,
    question: rfi.question,
    askedByName: req.user.name
  }).catch(() => {});
});

app.patch('/api/rfis/:id', requireAuth, (req, res) => {
  const data = db.load();
  const rfi = data.rfis.find(r => r.id === Number(req.params.id));
  if (!rfi) return res.status(404).json({ error: 'RFI not found' });

  const canAnswer = rfi.assignedTo === req.user.id || isManager(req.user, data);
  if (!canAnswer) return res.status(403).json({ error: 'Only the assigned team member (or a project manager) can answer this RFI' });

  const { answer } = req.body;
  if (!answer || !answer.trim()) return res.status(400).json({ error: 'Answer text is required' });

  rfi.answer = answer.trim();
  rfi.answeredAt = new Date().toISOString();

  db.save(data);
  res.json(enrichRfi(rfi, data));
});

// My open RFIs — a lightweight "something is waiting on you" list, across every project.
// Admins can check another team member's via ?userId=, same pattern as /api/my-tasks.
app.get('/api/my-rfis', requireAuth, (req, res) => {
  const data = db.load();
  let targetUser = req.user;
  if (req.query.userId !== undefined) {
    if (Number(req.query.userId) !== req.user.id && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Only an admin can view another team member\'s RFIs' });
    }
    const found = data.users.find(u => u.id === Number(req.query.userId));
    if (!found) return res.status(404).json({ error: 'User not found' });
    targetUser = found;
  }

  const openRfis = data.rfis
    .filter(r => r.assignedTo === targetUser.id && !r.answer)
    .map(r => ({ ...enrichRfi(r, data), project: data.projects.find(p => p.id === r.projectId) || null }))
    .sort((a, b) => a.overdue === b.overdue ? (a.dueDate < b.dueDate ? -1 : 1) : (a.overdue ? -1 : 1));

  res.json({ user: targetUser, rfis: openRfis });
});

// --- portfolio timeline (org-wide, visible to every logged-in user) ---
app.get('/api/portfolio', requireAuth, (req, res) => {
  const data = db.load();
  const portfolio = data.projects.map(p => {
    const tasks = data.tasks.filter(t => t.projectId === p.id);
    const assigneeIds = [...new Set(tasks.map(t => t.assigneeId).filter(Boolean))];
    const team = assigneeIds
      .map(id => data.users.find(u => u.id === id))
      .filter(Boolean);
    const enriched = withComputedProgress(p, data);
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      startDate: p.startDate,
      endDate: p.endDate,
      stage: p.stage,
      color: p.color,
      progress: enriched.progress,
      progressMode: p.progressMode,
      taskProgress: enriched.taskProgress,
      createdBy: p.createdBy,
      team
    };
  });
  res.json(portfolio);
});

// Multer (and other upload) errors land here instead of the default HTML error page.
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Civil PM app running at http://localhost:${PORT}`);
});
