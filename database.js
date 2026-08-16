// Forge AI — SQLite database layer
// Uses better-sqlite3: synchronous, no separate server process, file-based.

const path = require("path");
const Database = require("better-sqlite3");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "forge.sqlite3");
const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS connection_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  project_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER
);

CREATE TABLE IF NOT EXISTS studio_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  last_seen INTEGER,
  connected INTEGER NOT NULL DEFAULT 0,
  studio_version TEXT,
  place_id TEXT,
  job_id TEXT
);

CREATE TABLE IF NOT EXISTS builds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  project_id TEXT,
  system_name TEXT NOT NULL,
  files TEXT NOT NULL,           -- JSON-encoded array of file descriptors
  status TEXT NOT NULL DEFAULT 'queued', -- queued | sent | delivered | failed
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  delivered_at INTEGER,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_builds_code_status ON builds(code, status);
`);

/* ---------------- connection_codes ---------------- */

function ensureConnectionCode(code, projectId = null) {
  const existing = db.prepare("SELECT * FROM connection_codes WHERE code = ?").get(code);
  if (existing) return existing;
  const now = Date.now();
  db.prepare(
    "INSERT INTO connection_codes (code, project_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).run(code, projectId, now, null);
  return db.prepare("SELECT * FROM connection_codes WHERE code = ?").get(code);
}

function getConnectionCode(code) {
  return db.prepare("SELECT * FROM connection_codes WHERE code = ?").get(code);
}

/* ---------------- studio_sessions ---------------- */

function upsertSession(code, { studio_version = null, place_id = null, job_id = null } = {}) {
  const now = Date.now();
  const existing = db.prepare("SELECT * FROM studio_sessions WHERE code = ?").get(code);
  if (existing) {
    db.prepare(
      `UPDATE studio_sessions SET last_seen = ?, connected = 1, studio_version = COALESCE(?, studio_version),
       place_id = COALESCE(?, place_id), job_id = COALESCE(?, job_id) WHERE code = ?`
    ).run(now, studio_version, place_id, job_id, code);
  } else {
    db.prepare(
      `INSERT INTO studio_sessions (code, last_seen, connected, studio_version, place_id, job_id)
       VALUES (?, ?, 1, ?, ?, ?)`
    ).run(code, now, studio_version, place_id, job_id);
  }
  return db.prepare("SELECT * FROM studio_sessions WHERE code = ?").get(code);
}

function getSession(code) {
  return db.prepare("SELECT * FROM studio_sessions WHERE code = ?").get(code);
}

const CONNECTION_TIMEOUT_MS = 15000;

function isSessionConnected(session) {
  if (!session || !session.last_seen) return false;
  return Date.now() - session.last_seen < CONNECTION_TIMEOUT_MS;
}

/* ---------------- builds ---------------- */

function createBuild({ code, project_id = null, system_name, files }) {
  const now = Date.now();
  const info = db.prepare(
    `INSERT INTO builds (code, project_id, system_name, files, status, created_at)
     VALUES (?, ?, ?, ?, 'queued', ?)`
  ).run(code, project_id, system_name, JSON.stringify(files), now);
  return db.prepare("SELECT * FROM builds WHERE id = ?").get(info.lastInsertRowid);
}

function getQueuedBuilds(code) {
  return db.prepare("SELECT * FROM builds WHERE code = ? AND status = 'queued' ORDER BY created_at ASC").all(code);
}

function markBuildsSent(ids) {
  if (!ids.length) return;
  const now = Date.now();
  const stmt = db.prepare("UPDATE builds SET status = 'sent', sent_at = ? WHERE id = ?");
  const tx = db.transaction((list) => list.forEach((id) => stmt.run(now, id)));
  tx(ids);
}

// If a build was marked 'sent' but no result arrived within STALE_MS, revert to 'queued' so it gets retried.
const STALE_SENT_MS = 30000;
function revertStaleSentBuilds(code) {
  const cutoff = Date.now() - STALE_SENT_MS;
  db.prepare("UPDATE builds SET status = 'queued', sent_at = NULL WHERE code = ? AND status = 'sent' AND sent_at < ?")
    .run(code, cutoff);
}

function getBuild(id) {
  return db.prepare("SELECT * FROM builds WHERE id = ?").get(id);
}

function markBuildResult(id, { success, created = [], errors = [] }) {
  const now = Date.now();
  if (success) {
    db.prepare("UPDATE builds SET status = 'delivered', delivered_at = ?, error = NULL WHERE id = ?").run(now, id);
  } else {
    db.prepare("UPDATE builds SET status = 'failed', error = ? WHERE id = ?").run(
      (errors && errors.join("; ")) || "Erreur inconnue",
      id
    );
  }
  return getBuild(id);
}

function listBuilds(code) {
  return db.prepare("SELECT * FROM builds WHERE code = ? ORDER BY created_at DESC LIMIT 50").all(code);
}

function getLastBuild(code) {
  return db.prepare("SELECT * FROM builds WHERE code = ? ORDER BY created_at DESC LIMIT 1").get(code);
}

function getLastFailedBuild(code) {
  return db.prepare("SELECT * FROM builds WHERE code = ? AND status = 'failed' ORDER BY created_at DESC LIMIT 1").get(code);
}

function countQueued(code) {
  const row = db.prepare("SELECT COUNT(*) AS n FROM builds WHERE code = ? AND status IN ('queued','sent')").get(code);
  return row ? row.n : 0;
}

module.exports = {
  db,
  ensureConnectionCode,
  getConnectionCode,
  upsertSession,
  getSession,
  isSessionConnected,
  CONNECTION_TIMEOUT_MS,
  createBuild,
  getQueuedBuilds,
  markBuildsSent,
  revertStaleSentBuilds,
  getBuild,
  markBuildResult,
  listBuilds,
  getLastBuild,
  getLastFailedBuild,
  countQueued,
};
