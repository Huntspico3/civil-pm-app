const fs = require('fs');
const path = require('path');
const db = require('./db');

// Stored as newline-delimited JSON, separate from data.json — an audit log
// only ever grows (kept for 12+ months, nothing auto-deleted) and is almost
// never read compared to how often it's written to, so it shouldn't bloat
// or slow down every load/save of the app's main state. Appending a line is
// also, by construction, the only write operation this module exposes:
// there is no update or delete here, and the on-disk format itself is never
// rewritten in place — a line, once appended, is never touched again. That
// makes "entries can't be edited or deleted" true at the storage layer, not
// just because no route happens to expose it.
const LOG_PATH = path.join(db.DATA_DIR, 'audit-log.ndjson');

function append(entry) {
  fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n');
}

function readAll() {
  if (!fs.existsSync(LOG_PATH)) return [];
  const raw = fs.readFileSync(LOG_PATH, 'utf-8');
  return raw.split('\n').filter(Boolean).map(line => {
    try {
      return JSON.parse(line);
    } catch (e) {
      return null; // tolerate a partially-written last line rather than failing the whole read
    }
  }).filter(Boolean);
}

module.exports = { append, readAll };
