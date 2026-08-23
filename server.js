const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const db = require('./db');
const ai = require('./ai');

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
app.use('/uploads', express.static(UPLOADS_DIR));

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

app.use('/api', (req, res, next) => {
  if (req.path === '/gate/verify') return next();
  const token = req.headers['x-gate-token'];
  if (!token || !gateTokens.has(token)) {
    return res.status(401).json({ error: 'Shared password required', gateRequired: true });
  }
  next();
});

// --- auth: identity is selected on the login screen, sent as x-user-id header ---
function attachUser(req, res, next) {
  const idHeader = req.headers['x-user-id'];
  if (!idHeader) return next();
  const data = db.load();
  const user = data.users.find(u => u.id === Number(idHeader));
  if (user) req.user = user;
  next();
}
app.use(attachUser);

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

// --- roles ---
app.get('/api/roles', (req, res) => res.json(db.ROLES));

// --- stages ---
app.get('/api/stages', (req, res) => res.json(db.STAGES));

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
  const { name, email, phone, role } = req.body;
  if (!name || !email || !role) return res.status(400).json({ error: 'name, email, and role are required' });
  if (!db.ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const data = db.load();
  if (data.users.some(u => u.email.toLowerCase() === String(email).toLowerCase())) {
    return res.status(400).json({ error: 'A user with that email already exists' });
  }
  const user = { id: db.nextId('user'), name, email, phone: phone || '', role, isAdmin: false };
  data.users.push(user);
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
      ...p,
      taskCount: tasks.length,
      myTaskCount: tasks.filter(t => t.assigneeId === req.user.id).length
    };
  });
  res.json(withCounts);
});

app.post('/api/projects', requireAuth, (req, res) => {
  const { name, description, startDate, endDate, stage } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (stage && !db.STAGES.includes(stage)) return res.status(400).json({ error: 'Invalid stage' });

  const today = new Date();
  const defaultStart = today.toISOString().slice(0, 10);
  const defaultEnd = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const data = db.load();
  const project = {
    id: db.nextId('project'),
    name,
    description: description || '',
    createdBy: req.user.id,
    startDate: startDate || defaultStart,
    endDate: endDate || defaultEnd,
    stage: stage || db.STAGES[0]
  };
  data.projects.push(project);
  db.save(data);
  res.status(201).json(project);
});

app.get('/api/projects/:id', requireAuth, (req, res) => {
  const data = db.load();
  const project = data.projects.find(p => p.id === Number(req.params.id));
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!canSeeProject(req.user, project, data.tasks)) return res.status(403).json({ error: 'Not visible to you' });
  res.json(project);
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
  if (!db.ROLES.includes(requiredRole)) return res.status(400).json({ error: 'Invalid role' });

  let assignee = null;
  if (assigneeId) {
    assignee = data.users.find(u => u.id === Number(assigneeId));
    if (!assignee) return res.status(400).json({ error: 'Assignee not found' });
  }

  const task = {
    id: db.nextId('task'),
    projectId: project.id,
    title,
    description: description || '',
    requiredRole,
    assigneeId: assignee ? assignee.id : null,
    status: 'To Do'
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
  if (!isManager && !isAssignee) return res.status(403).json({ error: 'Not permitted to edit this task' });

  const { assigneeId, status, title, description, requiredRole } = req.body;

  if (assigneeId !== undefined) {
    if (!isManager) return res.status(403).json({ error: 'Only a project manager or admin can reassign tasks' });
    if (assigneeId === null) {
      task.assigneeId = null;
    } else {
      const assignee = data.users.find(u => u.id === Number(assigneeId));
      if (!assignee) return res.status(400).json({ error: 'Assignee not found' });
      task.assigneeId = assignee.id;
    }
  }
  if (status !== undefined) task.status = status;
  if (isManager && title !== undefined) task.title = title;
  if (isManager && description !== undefined) task.description = description;
  if (isManager && requiredRole !== undefined) {
    if (!db.ROLES.includes(requiredRole)) return res.status(400).json({ error: 'Invalid role' });
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

// --- portfolio timeline (org-wide, visible to every logged-in user) ---
app.get('/api/portfolio', requireAuth, (req, res) => {
  const data = db.load();
  const portfolio = data.projects.map(p => {
    const tasks = data.tasks.filter(t => t.projectId === p.id);
    const assigneeIds = [...new Set(tasks.map(t => t.assigneeId).filter(Boolean))];
    const team = assigneeIds
      .map(id => data.users.find(u => u.id === id))
      .filter(Boolean);
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      startDate: p.startDate,
      endDate: p.endDate,
      stage: p.stage,
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
