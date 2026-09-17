const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const auth = require('./auth');

// DATA_DIR lets a hosting platform point storage at a persistent disk
// (e.g. Render's mounted volume). Defaults to the app folder for local dev.
const DATA_DIR = process.env.DATA_DIR || __dirname;
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'data.json');

// Default engineering roles/disciplines, used only to seed a brand-new data.json
// or to backfill one saved before roles became admin-editable. The live, editable
// list lives in data.roles from here on.
const DEFAULT_ROLES = [
  'Structural', 'Civil', 'Geotechnical', 'Environmental', 'Transportation',
  'Highways / Roads Engineer', 'Water Resources / Hydraulics Engineer', 'Coastal Engineer',
  'Construction / Site Engineer', 'Quantity Surveying', 'MEP Coordinator',
  'Project Manager / Planning Engineer', 'Materials / Quality Engineer', 'BIM Coordinator'
];
// Same admin-editable-list pattern as roles: these are only defaults for a
// brand-new data.json or for backfilling an older one. Live lists are
// data.stages, data.taskStatuses, and data.externalContactCategories.
const DEFAULT_STAGES = ['Planning', 'Design', 'Approval', 'Construction', 'Completed'];
const DEFAULT_TASK_STATUSES = ['To Do', 'In Progress', 'Review', 'Done'];
const DEFAULT_EXTERNAL_CONTACT_CATEGORIES = ['Subcontractor', 'Structural Consultant', 'Local Authority', 'Quantity Surveyor', 'Client Representative', 'Consultant', 'Supplier'];

// Default palette for new projects' Gantt bars — cycled by creation order so
// consecutive projects get visually distinct colors out of the box. Admins can
// override any project's color individually via the Portfolio Timeline.
const PROJECT_COLOR_PALETTE = [
  '#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed',
  '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5'
];

// Known initial passwords for the seeded demo users, used both when seeding a
// brand-new data.json and when backfilling an older one that predates real
// per-user login. Any OTHER existing user (invited for real, not part of this
// list) gets a random temporary password instead — see backfillSchema below.
const DEFAULT_USER_PASSWORDS = {
  'admin@example.com': 'Admin2026!',
  'priya@example.com': 'Priya2026!',
  'sam@example.com': 'Sam2026!',
  'jordan@example.com': 'Jordan2026!',
  'casey@example.com': 'Casey2026!'
};

function seed() {
  return {
    nextIds: { user: 6, project: 3, task: 8, externalContact: 5, report: 1, rfi: 4, document: 1, snag: 1 },
    roles: DEFAULT_ROLES.slice(),
    stages: DEFAULT_STAGES.slice(),
    taskStatuses: DEFAULT_TASK_STATUSES.slice(),
    externalContactCategories: DEFAULT_EXTERNAL_CONTACT_CATEGORIES.slice(),
    users: [
      { id: 1, name: 'Alex Rivera', email: 'admin@example.com', phone: '555-0101', role: 'Civil', isAdmin: true },
      { id: 2, name: 'Priya Nair', email: 'priya@example.com', phone: '555-0102', role: 'Structural', isAdmin: false },
      { id: 3, name: 'Sam Okafor', email: 'sam@example.com', phone: '555-0103', role: 'Geotechnical', isAdmin: false },
      { id: 4, name: 'Jordan Lee', email: 'jordan@example.com', phone: '555-0104', role: 'Environmental', isAdmin: false },
      { id: 5, name: 'Casey Wu', email: 'casey@example.com', phone: '555-0105', role: 'Transportation', isAdmin: false }
    ],
    userCredentials: [
      { userId: 1, passwordHash: auth.hashPassword(DEFAULT_USER_PASSWORDS['admin@example.com']) },
      { userId: 2, passwordHash: auth.hashPassword(DEFAULT_USER_PASSWORDS['priya@example.com']) },
      { userId: 3, passwordHash: auth.hashPassword(DEFAULT_USER_PASSWORDS['sam@example.com']) },
      { userId: 4, passwordHash: auth.hashPassword(DEFAULT_USER_PASSWORDS['jordan@example.com']) },
      { userId: 5, passwordHash: auth.hashPassword(DEFAULT_USER_PASSWORDS['casey@example.com']) }
    ],
    projects: [
      {
        id: 1,
        name: 'Riverside Bridge Rehabilitation',
        description: 'Structural assessment and rehab of the Riverside Ave bridge deck and piers.',
        createdBy: 1,
        startDate: '2026-03-01',
        endDate: '2026-12-15',
        stage: 'Construction',
        color: PROJECT_COLOR_PALETTE[0],
        progress: 60,
        progressMode: 'auto',
        summary: null
      },
      {
        id: 2,
        name: 'Maple Street Corridor Upgrade',
        description: 'Road widening, drainage, and traffic signal upgrades along Maple Street.',
        createdBy: 1,
        startDate: '2026-06-01',
        endDate: '2027-02-28',
        stage: 'Design',
        color: PROJECT_COLOR_PALETTE[1],
        progress: 20,
        progressMode: 'auto',
        summary: null
      }
    ],
    tasks: [
      { id: 1, projectId: 1, title: 'Deck load rating analysis', description: 'Run updated load rating for the bridge deck.', requiredRole: 'Structural', assigneeId: 2, status: 'In Progress', progress: 40, dueDate: '2026-10-01', completedAt: null },
      { id: 2, projectId: 1, title: 'Pier foundation soil report', description: 'Review boring logs and assess pier settlement risk.', requiredRole: 'Geotechnical', assigneeId: 3, status: 'To Do', progress: 0, dueDate: '2026-10-15', completedAt: null },
      { id: 3, projectId: 1, title: 'Erosion control plan', description: 'Draft erosion & sediment control plan for the riverbank work zone.', requiredRole: 'Environmental', assigneeId: 4, status: 'To Do', progress: 0, dueDate: null, completedAt: null },
      { id: 4, projectId: 2, title: 'Storm drainage design', description: 'Size new storm drains for the widened corridor.', requiredRole: 'Civil', assigneeId: 1, status: 'To Do', progress: 0, dueDate: '2026-11-01', completedAt: null },
      { id: 5, projectId: 2, title: 'Signal timing plan', description: 'Develop signal timing plan for the two new intersections.', requiredRole: 'Transportation', assigneeId: 5, status: 'In Progress', progress: 60, dueDate: '2026-10-20', completedAt: null },
      { id: 6, projectId: 2, title: 'Retaining wall check', description: 'Check retaining wall stability near station 3+00.', requiredRole: 'Structural', assigneeId: 2, status: 'Done', progress: 100, dueDate: '2026-09-01', completedAt: null },
      { id: 7, projectId: 2, title: 'Wetland impact review', description: 'Assess corridor impact on adjacent wetland buffer.', requiredRole: 'Environmental', assigneeId: null, status: 'To Do', progress: 0, dueDate: null, completedAt: null }
    ],
    externalContacts: [
      { id: 1, name: 'John Carter', company: 'ABC Groundworks Ltd', category: 'Subcontractor', phone: '555-0201', email: 'john.carter@abcgroundworks.example', projectId: 2 },
      { id: 2, name: 'Sarah Whitfield', company: 'Whitfield Consulting', category: 'Structural Consultant', phone: '555-0202', email: 'sarah.whitfield@whitfieldconsulting.example', projectId: 1 },
      { id: 3, name: 'Michael Osei', company: 'City Council Planning', category: 'Local Authority', phone: '555-0203', email: 'michael.osei@citycouncil.example', projectId: null },
      { id: 4, name: 'Laura Bennett', company: 'Bennett & Co QS', category: 'Quantity Surveyor', phone: '555-0204', email: 'laura.bennett@bennettqs.example', projectId: 1 }
    ],
    reports: [],
    rfis: [
      {
        id: 1,
        projectId: 1,
        question: 'Can you confirm the required rebar cover for the north pier footing per the updated spec?',
        assignedTo: 2,
        dueDate: '2026-08-10',
        answer: null,
        createdBy: 1,
        createdAt: '2026-08-01T09:00:00.000Z',
        answeredAt: null
      },
      {
        id: 2,
        projectId: 1,
        question: 'What is the expected drying time before applying the epoxy coating to the repaired deck section?',
        assignedTo: 2,
        dueDate: '2026-09-15',
        answer: null,
        createdBy: 1,
        createdAt: '2026-08-20T09:00:00.000Z',
        answeredAt: null
      },
      {
        id: 3,
        projectId: 2,
        question: "Should the new storm drain tie into the existing 300mm main on Maple St or route to the new outfall?",
        assignedTo: 1,
        dueDate: '2026-07-20',
        answer: "Tie into the new outfall per the updated drainage plan — the existing 300mm main doesn't have capacity for the added flow.",
        createdBy: 5,
        createdAt: '2026-07-10T09:00:00.000Z',
        answeredAt: '2026-07-18T14:30:00.000Z'
      }
    ],
    documents: [],
    snags: []
  };
}

let cache = null;

// Maps each top-level collection to its nextIds counter key. Whenever a data.json
// was created before a given collection existed (e.g. an older save from before the
// RFI feature shipped), that key is simply absent from the file on disk. Backfilling
// it here means every past and future collection self-heals on load instead of
// crashing with "Cannot read properties of undefined" the first time it's touched.
const COLLECTIONS = {
  users: 'user',
  projects: 'project',
  tasks: 'task',
  externalContacts: 'externalContact',
  reports: 'report',
  rfis: 'rfi',
  documents: 'document',
  snags: 'snag'
};

function backfillSchema(data) {
  let changed = false;
  if (!data.nextIds) {
    data.nextIds = {};
    changed = true;
  }
  if (!Array.isArray(data.roles)) {
    data.roles = DEFAULT_ROLES.slice();
    changed = true;
  }
  if (!Array.isArray(data.stages)) {
    data.stages = DEFAULT_STAGES.slice();
    changed = true;
  }
  if (!Array.isArray(data.taskStatuses)) {
    data.taskStatuses = DEFAULT_TASK_STATUSES.slice();
    changed = true;
  }
  if (!Array.isArray(data.externalContactCategories)) {
    data.externalContactCategories = DEFAULT_EXTERNAL_CONTACT_CATEGORIES.slice();
    changed = true;
  }
  if (!Array.isArray(data.userCredentials)) {
    data.userCredentials = [];
    changed = true;
  }
  // Any user saved before real per-user login existed won't have a credential
  // record yet. Known demo users get their documented default password; any
  // other (genuinely invited) user gets a random one-time password, logged to
  // the server console so whoever runs this deploy can retrieve and share it.
  if (Array.isArray(data.users)) {
    data.users.forEach(u => {
      if (data.userCredentials.some(c => c.userId === u.id)) return;
      const knownPassword = u.email && DEFAULT_USER_PASSWORDS[u.email.toLowerCase()];
      if (knownPassword) {
        data.userCredentials.push({ userId: u.id, passwordHash: auth.hashPassword(knownPassword) });
      } else {
        const tempPassword = crypto.randomBytes(9).toString('base64url');
        data.userCredentials.push({ userId: u.id, passwordHash: auth.hashPassword(tempPassword) });
        console.log(`[auth migration] Generated a temporary password for ${u.email} (${u.name}): ${tempPassword} — share this with them securely; there's no self-service password change yet.`);
      }
      changed = true;
    });
  }
  for (const [collectionKey, idKey] of Object.entries(COLLECTIONS)) {
    if (!Array.isArray(data[collectionKey])) {
      data[collectionKey] = [];
      changed = true;
    }
    if (typeof data.nextIds[idKey] !== 'number') {
      const maxId = data[collectionKey].reduce((max, item) => Math.max(max, item.id || 0), 0);
      data.nextIds[idKey] = maxId + 1;
      changed = true;
    }
  }
  // Projects created before the Portfolio Timeline color/progress feature won't
  // have these fields yet — backfill so every bar still renders correctly.
  if (Array.isArray(data.projects)) {
    data.projects.forEach((p, index) => {
      if (!p.color) {
        p.color = PROJECT_COLOR_PALETTE[index % PROJECT_COLOR_PALETTE.length];
        changed = true;
      }
      if (typeof p.progress !== 'number') {
        p.progress = 0;
        changed = true;
      }
      if (p.progressMode !== 'auto' && p.progressMode !== 'manual') {
        // Existing projects predate auto-calculated progress — default them to
        // automatic so progress reflects real task completion going forward.
        p.progressMode = 'auto';
        changed = true;
      }
      // The weekly AI summary is optional until the first one is generated.
      if (!('summary' in p)) {
        p.summary = null;
        changed = true;
      }
    });
  }
  // Tasks created before per-task progress existed won't have it yet. Default
  // to 0 would suddenly crater every project's auto-calculated progress, so
  // instead estimate from the task's current status position (e.g. "Done" in
  // a 4-column board defaults to 100%, "To Do" to 0%) as a reasonable
  // starting point — the assignee can then fine-tune the real number.
  if (Array.isArray(data.tasks)) {
    const statusCount = data.taskStatuses.length;
    data.tasks.forEach(t => {
      if (typeof t.progress !== 'number') {
        const index = data.taskStatuses.indexOf(t.status);
        t.progress = statusCount > 1 && index >= 0 ? Math.round((index / (statusCount - 1)) * 100) : 0;
        changed = true;
      }
      // Tasks created before due dates existed simply don't have one yet —
      // null is a valid "no due date set" state, same as for RFIs.
      if (!('dueDate' in t)) {
        t.dueDate = null;
        changed = true;
      }
      // completedAt only tracks transitions to "Done" going forward (set by
      // the PATCH endpoint) — there's no reliable way to know when an
      // already-Done task actually finished, so it backfills to null rather
      // than guessing. It simply won't count toward "completed this week"
      // until it's marked Done again.
      if (!('completedAt' in t)) {
        t.completedAt = null;
        changed = true;
      }
    });
  }
  return changed;
}

function load() {
  if (cache) return cache;
  if (!fs.existsSync(DB_PATH)) {
    cache = seed();
    save(cache);
  } else {
    cache = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    if (backfillSchema(cache)) save(cache);
  }
  return cache;
}

function save(data) {
  cache = data;
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function nextId(kind) {
  const data = load();
  const id = data.nextIds[kind]++;
  save(data);
  return id;
}

module.exports = {
  load, save, nextId,
  DEFAULT_ROLES, DEFAULT_STAGES, DEFAULT_TASK_STATUSES, DEFAULT_EXTERNAL_CONTACT_CATEGORIES,
  PROJECT_COLOR_PALETTE, DATA_DIR
};
