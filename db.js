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

// A sensible starting % complete for a task sitting in a given status,
// spread evenly across however many statuses exist (e.g. with the 4 default
// statuses: To Do=0%, In Progress=33%, Review=67%, Done=100%) so moving a
// task to a new column starts it from something reasonable rather than 0 or
// whatever it was before. Used both to backfill tasks that predate per-task
// progress and, in server.js, to re-default progress on a status change.
// The Monday (YYYY-MM-DD) of the week containing a given date — weekly
// updates run Monday-Sunday, so this is both how "this week" is identified
// and how a submitted weekStart is validated (mondayOf(weekStart) must
// equal weekStart, or it isn't actually a Monday).
function mondayOf(dateInput) {
  const d = typeof dateInput === 'string' ? new Date(dateInput + 'T00:00:00') : new Date(dateInput);
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  // Local getters, not toISOString() — toISOString() converts to UTC first,
  // which silently shifts the date backward a day in any timezone ahead of
  // UTC (midnight local is still "yesterday" in UTC).
  const yyyy = monday.getFullYear();
  const mm = String(monday.getMonth() + 1).padStart(2, '0');
  const dd = String(monday.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function defaultProgressForStatus(status, taskStatuses) {
  const statusCount = taskStatuses.length;
  const index = taskStatuses.indexOf(status);
  return statusCount > 1 && index >= 0 ? Math.round((index / (statusCount - 1)) * 100) : 0;
}

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
    nextIds: { user: 6, project: 3, task: 8, externalContact: 5, report: 1, rfi: 4, document: 1, snag: 1, risk: 1, decision: 1, changeOrder: 1, weeklyUpdate: 1, projectContact: 1 },
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
        code: 'RBR-2026-01',
        client: 'City of Riverside Public Works',
        siteAddress: '400 Riverside Ave, Riverside',
        createdBy: 1,
        startDate: '2026-03-01',
        endDate: '2026-12-15',
        stage: 'Construction',
        color: PROJECT_COLOR_PALETTE[0],
        progress: 60,
        progressMode: 'auto',
        summary: null,
        location: null,
        latitude: null,
        longitude: null
      },
      {
        id: 2,
        name: 'Maple Street Corridor Upgrade',
        description: 'Road widening, drainage, and traffic signal upgrades along Maple Street.',
        code: 'MSC-2026-02',
        client: 'City Transportation Department',
        siteAddress: 'Maple St between 3rd Ave and 9th Ave',
        createdBy: 1,
        startDate: '2026-06-01',
        endDate: '2027-02-28',
        stage: 'Design',
        color: PROJECT_COLOR_PALETTE[1],
        progress: 20,
        progressMode: 'auto',
        summary: null,
        location: null,
        latitude: null,
        longitude: null
      }
    ],
    tasks: [
      { id: 1, projectId: 1, title: 'Deck load rating analysis', description: 'Run updated load rating for the bridge deck.', requiredRole: 'Structural', assigneeId: 2, status: 'In Progress', progress: 40, startDate: '2026-09-01', dueDate: '2026-10-01', completedAt: null, workDone: 'Completed initial load calculations; now reviewing against the updated code requirements.', comments: [] },
      { id: 2, projectId: 1, title: 'Pier foundation soil report', description: 'Review boring logs and assess pier settlement risk.', requiredRole: 'Geotechnical', assigneeId: 3, status: 'To Do', progress: 0, startDate: null, dueDate: '2026-10-15', completedAt: null, workDone: '', comments: [] },
      { id: 3, projectId: 1, title: 'Erosion control plan', description: 'Draft erosion & sediment control plan for the riverbank work zone.', requiredRole: 'Environmental', assigneeId: 4, status: 'To Do', progress: 0, startDate: null, dueDate: null, completedAt: null, workDone: '', comments: [] },
      { id: 4, projectId: 2, title: 'Storm drainage design', description: 'Size new storm drains for the widened corridor.', requiredRole: 'Civil', assigneeId: 1, status: 'To Do', progress: 0, startDate: null, dueDate: '2026-11-01', completedAt: null, workDone: '', comments: [] },
      { id: 5, projectId: 2, title: 'Signal timing plan', description: 'Develop signal timing plan for the two new intersections.', requiredRole: 'Transportation', assigneeId: 5, status: 'In Progress', progress: 60, startDate: '2026-09-10', dueDate: '2026-10-20', completedAt: null, workDone: 'Drafted the initial signal phasing plan for both intersections.', comments: [] },
      { id: 6, projectId: 2, title: 'Retaining wall check', description: 'Check retaining wall stability near station 3+00.', requiredRole: 'Structural', assigneeId: 2, status: 'Done', progress: 100, startDate: '2026-08-01', dueDate: '2026-09-01', completedAt: null, workDone: 'Completed the stability check — no issues found.', comments: [] },
      { id: 7, projectId: 2, title: 'Wetland impact review', description: 'Assess corridor impact on adjacent wetland buffer.', requiredRole: 'Environmental', assigneeId: null, status: 'To Do', progress: 0, startDate: null, dueDate: null, completedAt: null, workDone: '', comments: [] }
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
    snags: [],
    risks: [],
    decisions: [],
    changeOrders: [],
    weeklyUpdates: [],
    projectContacts: []
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
  snags: 'snag',
  risks: 'risk',
  decisions: 'decision',
  changeOrders: 'changeOrder',
  weeklyUpdates: 'weeklyUpdate',
  projectContacts: 'projectContact'
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
      // Project Profile fields (code/client/site address) are all optional
      // and postdate this schema, so older projects simply don't have them.
      if (!('code' in p)) {
        p.code = null;
        p.client = null;
        p.siteAddress = null;
        changed = true;
      }
      // Weather is opt-in — no location set means no forecast shown, not an error.
      if (!('location' in p)) {
        p.location = null;
        p.latitude = null;
        p.longitude = null;
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
    data.tasks.forEach(t => {
      if (typeof t.progress !== 'number') {
        t.progress = defaultProgressForStatus(t.status, data.taskStatuses);
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
      // Tasks created before comments existed just start with none.
      if (!Array.isArray(t.comments)) {
        t.comments = [];
        changed = true;
      }
      // Start date is as optional as the due date always was — null means
      // "not set" rather than being guessed from anything else.
      if (!('startDate' in t)) {
        t.startDate = null;
        changed = true;
      }
      // "Work Done in Period" is a free-text progress note, blank until
      // someone (the assignee or this project's manager) writes one.
      if (!('workDone' in t)) {
        t.workDone = '';
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
  load, save, nextId, defaultProgressForStatus, mondayOf,
  DEFAULT_ROLES, DEFAULT_STAGES, DEFAULT_TASK_STATUSES, DEFAULT_EXTERNAL_CONTACT_CATEGORIES,
  PROJECT_COLOR_PALETTE, DATA_DIR
};
