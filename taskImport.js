const path = require('path');
const ExcelJS = require('exceljs');
const fileValidation = require('./fileValidation');

// Recognized column headers, keyed by the canonical field they map to.
// Matching is case-insensitive and ignores spaces/punctuation, so "Due Date",
// "due_date" and "DueDate" all resolve to the same field. Keeps the first
// version of this feature simple — no manual column-mapping UI — while still
// tolerating the header variations a real spreadsheet is likely to use.
const HEADER_ALIASES = {
  title: ['title', 'task', 'taskname', 'taskstitle', 'name'],
  description: ['description', 'desc', 'details', 'notes'],
  assigneeRaw: ['assignee', 'assignedto', 'assignedperson', 'person', 'email', 'assigneeemail'],
  requiredRole: ['role', 'discipline', 'requiredrole', 'disciplinerole'],
  status: ['status'],
  dueDate: ['duedate', 'due']
};

function normalizeHeader(h) {
  return String(h == null ? '' : h).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function fieldForHeader(header) {
  const normalized = normalizeHeader(header);
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(normalized)) return field;
  }
  return null;
}

// Converts raw parsed rows (row[0] = header row) into normalized row objects
// with canonical field names. Blank rows are dropped.
function rowsToObjects(rows) {
  if (rows.length === 0) return [];
  const fieldForCol = rows[0].map(fieldForHeader);
  return rows.slice(1)
    .filter(r => r.some(cell => String(cell == null ? '' : cell).trim() !== ''))
    .map(r => {
      const obj = { title: '', description: '', assigneeRaw: '', requiredRole: '', status: '', dueDate: '' };
      r.forEach((cell, colIndex) => {
        const field = fieldForCol[colIndex];
        if (field) obj[field] = String(cell == null ? '' : cell).trim();
      });
      return obj;
    });
}

// A small RFC4180-ish CSV parser (quoted fields, embedded commas/newlines,
// "" as an escaped quote) — no external dependency needed for plain CSV.
function parseCsv(buffer) {
  let text = buffer.toString('utf8');
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip BOM (common from Excel "Save as CSV")

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }

  return rows.filter(r => !(r.length === 1 && r[0].trim() === ''));
}

function cellToString(value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (Array.isArray(value.richText)) return value.richText.map(t => t.text).join('');
    if ('result' in value) return cellToString(value.result);
  }
  return String(value);
}

async function parseXlsxRows(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];
  const rows = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    rows.push(row.values.slice(1).map(cellToString)); // row.values is 1-indexed
  });
  return rows;
}

// Parses an uploaded spreadsheet into normalized (but not yet validated) row
// objects, based on its extension. Throws a user-facing Error on anything
// that isn't a well-formed .csv or .xlsx.
async function parseFile(filename, buffer) {
  const ext = path.extname(filename || '').toLowerCase();
  if (ext === '.csv') return rowsToObjects(parseCsv(buffer));
  if (ext === '.xlsx') {
    if (!fileValidation.isValidXlsxBuffer(buffer)) {
      throw new Error('The uploaded file is not a valid .xlsx file');
    }
    return rowsToObjects(await parseXlsxRows(buffer));
  }
  throw new Error('Unsupported file type — upload a .csv or .xlsx file');
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const US_DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

// Rejects a well-formed-looking but nonexistent date (e.g. 2026-02-30,
// 13/40/2026) by checking the parts survive a round trip through Date's own
// calendar math, rather than just matching the digit pattern.
function isRealDate(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function parseDueDate(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return { value: null, error: null };

  const isoMatch = trimmed.match(ISO_DATE_RE);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    if (!isRealDate(Number(y), Number(m), Number(d))) {
      return { value: null, error: `"${trimmed}" isn't a real date` };
    }
    return { value: trimmed, error: null };
  }

  const usMatch = trimmed.match(US_DATE_RE);
  if (usMatch) {
    const [, m, d, y] = usMatch;
    if (!isRealDate(Number(y), Number(m), Number(d))) {
      return { value: null, error: `"${trimmed}" isn't a real date` };
    }
    return { value: `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`, error: null };
  }

  return { value: null, error: `Unrecognized due date "${trimmed}" — use YYYY-MM-DD or MM/DD/YYYY` };
}

// Validates one normalized row against the current roles/statuses/team, the
// same way the server would validate a task created through the regular
// "New Task" form. Never throws — every problem is collected into `errors`
// so one bad row can be flagged and skipped instead of failing the whole
// import. Reused for both the preview endpoint (freshly parsed rows) and the
// confirm endpoint (the same row shape echoed back by the client), so the
// server always re-validates for itself rather than trusting either input.
function validateImportRow(row, rowNumber, data) {
  const errors = [];

  const title = (row.title || '').trim();
  if (!title) errors.push('Title is required');

  const description = (row.description || '').trim();

  let requiredRole = (row.requiredRole || '').trim();
  if (!requiredRole) {
    errors.push('Discipline/Role is required');
  } else {
    const match = data.roles.find(r => r.toLowerCase() === requiredRole.toLowerCase());
    if (!match) errors.push(`Unknown discipline/role "${requiredRole}"`);
    else requiredRole = match;
  }

  let status = (row.status || '').trim();
  if (!status) {
    status = data.taskStatuses[0];
  } else {
    const match = data.taskStatuses.find(s => s.toLowerCase() === status.toLowerCase());
    if (!match) errors.push(`Unknown status "${status}"`);
    else status = match;
  }

  const { value: dueDate, error: dueDateError } = parseDueDate(row.dueDate);
  if (dueDateError) errors.push(dueDateError);

  const assigneeRaw = (row.assigneeRaw || '').trim();
  let assigneeId = null;
  let assigneeName = null;
  if (assigneeRaw) {
    const match = data.users.find(u => u.email.toLowerCase() === assigneeRaw.toLowerCase())
      || data.users.find(u => u.name.toLowerCase() === assigneeRaw.toLowerCase());
    if (match) {
      assigneeId = match.id;
      assigneeName = match.name;
    } else {
      errors.push(`No team member found matching "${assigneeRaw}"`);
    }
  }

  return { rowNumber, title, description, requiredRole, status, dueDate, assigneeRaw, assigneeId, assigneeName, errors };
}

module.exports = { parseFile, validateImportRow };
