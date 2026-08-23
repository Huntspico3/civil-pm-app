const fs = require('fs');
const path = require('path');

// DATA_DIR lets a hosting platform point storage at a persistent disk
// (e.g. Render's mounted volume). Defaults to the app folder for local dev.
const DATA_DIR = process.env.DATA_DIR || __dirname;
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'data.json');

const ROLES = ['Structural', 'Civil', 'Geotechnical', 'Environmental', 'Transportation'];
const STAGES = ['Planning', 'Design', 'Approval', 'Construction', 'Completed'];

function seed() {
  return {
    nextIds: { user: 6, project: 3, task: 8, externalContact: 5, report: 1 },
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
    reports: []
  };
}

let cache = null;

function load() {
  if (cache) return cache;
  if (!fs.existsSync(DB_PATH)) {
    cache = seed();
    save(cache);
  } else {
    cache = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
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

module.exports = { load, save, nextId, ROLES, STAGES, DATA_DIR };
