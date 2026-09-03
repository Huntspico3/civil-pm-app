const fs = require('fs');
const path = require('path');

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
const STAGES = ['Planning', 'Design', 'Approval', 'Construction', 'Completed'];
// Task board columns. Kept as a simple ordered list (like ROLES/STAGES above) so
// column names/order can become editable later without changing the data shape.
const TASK_STATUSES = ['To Do', 'In Progress', 'Review', 'Done'];

function seed() {
  return {
    nextIds: { user: 6, project: 3, task: 8, externalContact: 5, report: 1, rfi: 4 },
    roles: DEFAULT_ROLES.slice(),
    users: [
      { id: 1, name: 'Alex Rivera', email: 'admin@example.com', phone: '555-0101', role: 'Civil', isAdmin: true },
      { id: 2, name: 'Priya Nair', email: 'priya@example.com', phone: '555-0102', role: 'Structural', isAdmin: false },
      { id: 3, name: 'Sam Okafor', email: 'sam@example.com', phone: '555-0103', role: 'Geotechnical', isAdmin: false },
      { id: 4, name: 'Jordan Lee', email: 'jordan@example.com', phone: '555-0104', role: 'Environmental', isAdmin: false },
      { id: 5, name: 'Casey Wu', email: 'casey@example.com', phone: '555-0105', role: 'Transportation', isAdmin: false }
    ],
    projects: [
      {
        id: 1,
        name: 'Riverside Bridge Rehabilitation',
        description: 'Structural assessment and rehab of the Riverside Ave bridge deck and piers.',
        createdBy: 1,
        startDate: '2026-03-01',
        endDate: '2026-12-15',
        stage: 'Construction'
      },
      {
        id: 2,
        name: 'Maple Street Corridor Upgrade',
        description: 'Road widening, drainage, and traffic signal upgrades along Maple Street.',
        createdBy: 1,
        startDate: '2026-06-01',
        endDate: '2027-02-28',
        stage: 'Design'
      }
    ],
    tasks: [
      { id: 1, projectId: 1, title: 'Deck load rating analysis', description: 'Run updated load rating for the bridge deck.', requiredRole: 'Structural', assigneeId: 2, status: 'In Progress' },
      { id: 2, projectId: 1, title: 'Pier foundation soil report', description: 'Review boring logs and assess pier settlement risk.', requiredRole: 'Geotechnical', assigneeId: 3, status: 'To Do' },
      { id: 3, projectId: 1, title: 'Erosion control plan', description: 'Draft erosion & sediment control plan for the riverbank work zone.', requiredRole: 'Environmental', assigneeId: 4, status: 'To Do' },
      { id: 4, projectId: 2, title: 'Storm drainage design', description: 'Size new storm drains for the widened corridor.', requiredRole: 'Civil', assigneeId: 1, status: 'To Do' },
      { id: 5, projectId: 2, title: 'Signal timing plan', description: 'Develop signal timing plan for the two new intersections.', requiredRole: 'Transportation', assigneeId: 5, status: 'In Progress' },
      { id: 6, projectId: 2, title: 'Retaining wall check', description: 'Check retaining wall stability near station 3+00.', requiredRole: 'Structural', assigneeId: 2, status: 'Done' },
      { id: 7, projectId: 2, title: 'Wetland impact review', description: 'Assess corridor impact on adjacent wetland buffer.', requiredRole: 'Environmental', assigneeId: null, status: 'To Do' }
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
    ]
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
  rfis: 'rfi'
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

module.exports = { load, save, nextId, DEFAULT_ROLES, STAGES, TASK_STATUSES, DATA_DIR };
