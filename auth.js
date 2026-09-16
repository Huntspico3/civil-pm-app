const crypto = require('crypto');

// Password hashing via Node's built-in scrypt (memory-hard KDF) — no extra
// dependency needed. Stored as "salt:hash", both hex-encoded.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const hashBuffer = Buffer.from(hash, 'hex');
  const suppliedHashBuffer = crypto.scryptSync(password, salt, 64);
  return hashBuffer.length === suppliedHashBuffer.length && crypto.timingSafeEqual(hashBuffer, suppliedHashBuffer);
}

// --- sessions ---
// In-memory only, like the shared-password gate tokens: everyone is signed out
// if the server restarts, which is an acceptable tradeoff for this app's scale
// and keeps this fix self-contained (no session store / DB migration needed).
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const sessions = new Map(); // token -> { userId, expiresAt }

function createSession(userId) {
  const token = crypto.randomUUID();
  sessions.set(token, { userId, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

function getSession(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function destroySession(token) {
  sessions.delete(token);
}

module.exports = { hashPassword, verifyPassword, createSession, getSession, destroySession };
