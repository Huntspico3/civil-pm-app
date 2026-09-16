// Generates realistic-looking demo data (10 projects, 300 tasks) directly
// into data.json, for exercising the app's task views at scale — search,
// filters, sorting, pagination, the Portfolio Timeline, etc. Every record it
// creates is tagged `isSample: true` and every task/project name is prefixed
// "[Sample]"/"Sample:" so it's easy to tell apart from real data and to
// delete later (filter by isSample). Re-running this script is safe — it
// removes whatever sample data it previously created before regenerating,
// so repeated runs never pile up duplicates.
//
// Usage (from the app/ directory, with the server stopped so nothing else
// is writing data.json at the same time):
//   node scripts/generateSampleData.js

const db = require('../db');

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}

function weightedPick(weightedEntries) {
  const total = weightedEntries.reduce((sum, [, weight]) => sum + weight, 0);
  let r = Math.random() * total;
  for (const [value, weight] of weightedEntries) {
    if (r < weight) return value;
    r -= weight;
  }
  return weightedEntries[weightedEntries.length - 1][0];
}

function isoDateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// 10 projects spanning every stage, from just-kicked-off to long finished.
// taskCount is intentionally uneven (12-55) rather than a flat 30 each, and
// sums to exactly 300.
const PROJECT_DEFS = [
  { name: 'Sample: Harborview Pedestrian Bridge', stage: 'Planning', startOffset: 30, endOffset: 300, taskCount: 12 },
  { name: 'Sample: Riverside Flood Wall Extension', stage: 'Planning', startOffset: 10, endOffset: 365, taskCount: 20 },
  { name: 'Sample: Elmwood Water Treatment Upgrade', stage: 'Design', startOffset: -30, endOffset: 200, taskCount: 22 },
  { name: 'Sample: Route 42 Interchange Redesign', stage: 'Design', startOffset: -60, endOffset: 250, taskCount: 28 },
  { name: 'Sample: Northgate Retaining Wall Repair', stage: 'Approval', startOffset: -45, endOffset: 120, taskCount: 18 },
  { name: 'Sample: Sunridge Business Park Site Works', stage: 'Construction', startOffset: -180, endOffset: 90, taskCount: 55 },
  { name: 'Sample: Fairview Elementary Seismic Retrofit', stage: 'Construction', startOffset: -240, endOffset: 60, taskCount: 48 },
  { name: 'Sample: Millbrook Culvert Replacement', stage: 'Construction', startOffset: -300, endOffset: 30, taskCount: 35 },
  { name: 'Sample: Lakeside Trail & Boardwalk', stage: 'Completed', startOffset: -400, endOffset: -30, taskCount: 32 },
  { name: 'Sample: Cedar Street Sewer Rehabilitation', stage: 'Completed', startOffset: -365, endOffset: -60, taskCount: 30 }
];

// How often each status shows up, by project stage — an early Planning
// project is mostly "To Do", a Completed one is almost all "Done", etc.
const STAGE_STATUS_WEIGHTS = {
  Planning: [['To Do', 70], ['In Progress', 20], ['Review', 5], ['Done', 5]],
  Design: [['To Do', 45], ['In Progress', 35], ['Review', 15], ['Done', 5]],
  Approval: [['To Do', 30], ['In Progress', 30], ['Review', 30], ['Done', 10]],
  Construction: [['To Do', 15], ['In Progress', 40], ['Review', 20], ['Done', 25]],
  Completed: [['To Do', 2], ['In Progress', 3], ['Review', 5], ['Done', 90]]
};

// Task title phrases per discipline, so a task's title actually matches its
// requiredRole (a "Structural" task reads like structural work, etc.).
const ROLE_TASK_TEMPLATES = {
  Civil: ['Storm drainage design', 'Site grading plan', 'Utility coordination', 'Road subgrade assessment', 'Stormwater detention sizing', 'Site drainage inspection', 'Earthworks quantity check', 'Access road layout review'],
  Structural: ['Deck load rating analysis', 'Beam connection design', 'Foundation reinforcement check', 'Structural steel shop drawing review', 'Retaining wall stability check', 'Seismic bracing review', 'Column capacity check', 'Pile cap design review'],
  Geotechnical: ['Boring log review', 'Soil bearing capacity assessment', 'Slope stability analysis', 'Groundwater monitoring', 'Settlement monitoring', 'Foundation soil report', 'Compaction testing review', 'Geotechnical investigation'],
  Environmental: ['Erosion control plan', 'Wetland impact review', 'Noise mitigation assessment', 'Air quality monitoring', 'Stormwater pollution prevention plan', 'Habitat impact survey', 'Environmental permit compliance check', 'Sediment control inspection'],
  Transportation: ['Signal timing plan', 'Traffic control plan', 'Pavement marking layout', 'Intersection capacity analysis', 'Traffic study', 'Signage plan review', 'Lane closure schedule', 'Pedestrian crossing design'],
  'Highways / Roads Engineer': ['Pavement design review', 'Road geometry check', 'Shoulder widening layout'],
  'Water Resources / Hydraulics Engineer': ['Culvert hydraulic capacity check', 'Floodplain modeling review', 'Stormwater outfall design'],
  'Coastal Engineer': ['Shoreline erosion assessment', 'Wave loading analysis', 'Seawall design check'],
  'Construction / Site Engineer': ['Site inspection', 'Daily progress log review', 'Site safety walk'],
  'Quantity Surveying': ['Bill of quantities review', 'Cost variance report', 'Progress valuation'],
  'MEP Coordinator': ['MEP clash detection review', 'HVAC routing coordination', 'Electrical load schedule review'],
  'Project Manager / Planning Engineer': ['Schedule update review', 'Stakeholder coordination meeting', 'Risk register update'],
  'Materials / Quality Engineer': ['Concrete mix design review', 'Material test report review', 'Quality audit'],
  'BIM Coordinator': ['BIM model federation check', 'Clash detection report', 'Model quality audit']
};

// Appended to about 5/6 of titles for flavor (e.g. "Foundation soil report –
// Block C"); the trailing nulls are what make it less than 100%.
const LOCATIONS = ['Block A', 'Block B', 'Block C', 'Station 2+00', 'Station 5+50', 'North Pier', 'South Pier', 'Phase 1', 'Phase 2', 'Zone 3', 'Segment 4', null, null];

function progressForStatus(status) {
  if (status === 'Done') return 100;
  if (status === 'Review') return randInt(70, 95);
  if (status === 'In Progress') return randInt(20, 80);
  return randInt(0, 100) < 80 ? 0 : randInt(5, 15); // "To Do" is mostly 0%, occasionally just started
}

// Ranges (days from today) per status, so overdue/due-soon/future dates all
// show up realistically — a Done task's due date is typically in the past,
// a To Do task's is typically still ahead (but not always, to get overdue
// To Do tasks too). ~15% of tasks get no due date at all, same as real data.
function dueDateForStatus(status) {
  if (Math.random() < 0.15) return null;
  let range;
  if (status === 'Done') range = [-180, -1];
  else if (status === 'Review') range = [-10, 10];
  else if (status === 'In Progress') range = [-20, 45];
  else range = [-5, 120];
  return isoDateOffset(randInt(range[0], range[1]));
}

function run() {
  const data = db.load();

  const stageNames = new Set(data.stages);
  const statusNames = new Set(data.taskStatuses);
  for (const def of PROJECT_DEFS) {
    if (!stageNames.has(def.stage)) {
      throw new Error(`Stage "${def.stage}" isn't in data.stages (${data.stages.join(', ')}) — your configured stages have changed from the defaults this script assumes.`);
    }
  }
  for (const weights of Object.values(STAGE_STATUS_WEIGHTS)) {
    for (const [status] of weights) {
      if (!statusNames.has(status)) {
        throw new Error(`Status "${status}" isn't in data.taskStatuses (${data.taskStatuses.join(', ')}) — your configured statuses have changed from the defaults this script assumes.`);
      }
    }
  }

  // Idempotent: drop any sample data from a previous run before regenerating,
  // so running this twice never leaves duplicates.
  const removedProjects = data.projects.filter(p => p.isSample).length;
  const removedTasks = data.tasks.filter(t => t.isSample).length;
  data.projects = data.projects.filter(p => !p.isSample);
  data.tasks = data.tasks.filter(t => !t.isSample);

  const admin = data.users.find(u => u.isAdmin) || data.users[0];
  const roleToUsers = {};
  data.users.forEach(u => {
    if (!roleToUsers[u.role]) roleToUsers[u.role] = [];
    roleToUsers[u.role].push(u);
  });
  const staffedRoles = Object.keys(roleToUsers);
  const unstaffedRoles = data.roles.filter(r => !staffedRoles.includes(r));

  let nextProjectId = data.nextIds.project;
  let nextTaskId = data.nextIds.task;

  const newProjects = PROJECT_DEFS.map((def, i) => ({
    id: nextProjectId++,
    name: def.name,
    description: "Auto-generated sample project for load-testing the app's task views at scale. Safe to delete (isSample: true).",
    createdBy: admin.id,
    startDate: isoDateOffset(def.startOffset),
    endDate: isoDateOffset(def.endOffset),
    stage: def.stage,
    color: db.PROJECT_COLOR_PALETTE[i % db.PROJECT_COLOR_PALETTE.length],
    progress: 0,
    progressMode: 'auto',
    isSample: true
  }));

  const newTasks = [];
  newProjects.forEach((project, pi) => {
    const def = PROJECT_DEFS[pi];
    const statusWeights = STAGE_STATUS_WEIGHTS[def.stage];
    for (let i = 0; i < def.taskCount; i++) {
      // ~85% of tasks use a role that has a real team member, so
      // assignment-by-discipline is meaningful to test; the rest use a role
      // nobody on the team currently covers and stay unassigned, mirroring
      // a realistic "no specialist yet" backlog.
      const useStaffedRole = unstaffedRoles.length === 0 || Math.random() < 0.85;
      const role = useStaffedRole ? pick(staffedRoles) : pick(unstaffedRoles);
      const templates = ROLE_TASK_TEMPLATES[role] || ['General task'];
      const location = pick(LOCATIONS);
      const title = `[Sample] ${pick(templates)}${location ? ' – ' + location : ''}`;

      const assigneeId = (useStaffedRole && Math.random() < 0.8) ? pick(roleToUsers[role]).id : null;
      const status = weightedPick(statusWeights);

      newTasks.push({
        id: nextTaskId++,
        projectId: project.id,
        title,
        description: 'Auto-generated sample task for testing task-list search, filtering, sorting, and pagination at scale.',
        requiredRole: role,
        assigneeId,
        status,
        progress: progressForStatus(status),
        dueDate: dueDateForStatus(status),
        isSample: true
      });
    }
  });

  data.projects.push(...newProjects);
  data.tasks.push(...newTasks);
  data.nextIds.project = nextProjectId;
  data.nextIds.task = nextTaskId;

  db.save(data);

  if (removedProjects || removedTasks) {
    console.log(`Removed ${removedProjects} sample project(s) and ${removedTasks} sample task(s) from a previous run.`);
  }
  console.log(`Created ${newProjects.length} sample projects and ${newTasks.length} sample tasks.\n`);
  newProjects.forEach(p => {
    const count = newTasks.filter(t => t.projectId === p.id).length;
    console.log(`  - ${p.name} [${p.stage}]: ${count} tasks`);
  });
}

run();
