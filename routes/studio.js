// Forge AI — Roblox Studio bridge routes
const express = require("express");
const db = require("../database");

const router = express.Router();

/* ------------------------------------------------------------------ */
/* POST /api/studio/register
   Called by the Forge AI frontend to bind a connection code to a project
   before the plugin ever connects. Idempotent.
   body: { code, project_id? } */
router.post("/register", (req, res) => {
  const { code, project_id } = req.body || {};
  if (!code || typeof code !== "string") {
    return res.status(400).json({ error: "code is required" });
  }
  const row = db.ensureConnectionCode(code, project_id || null);
  res.json({ ok: true, code: row.code, project_id: row.project_id });
});

/* ------------------------------------------------------------------ */
/* POST /api/studio/heartbeat/:code
   Called by the Roblox Studio plugin every 5 seconds.
   body (optional): { studio_version, place_id, job_id } */
router.post("/heartbeat/:code", (req, res) => {
  const { code } = req.params;

  // A heartbeat implicitly proves a real plugin is live for this code.
  // We still require the code to have been registered by the frontend at least once,
  // to avoid random codes creating orphan sessions.
  const known = db.getConnectionCode(code);
  if (!known) {
    db.ensureConnectionCode(code, null); // auto-register on first real heartbeat too
  }

  const { studio_version, place_id, job_id } = req.body || {};
  db.upsertSession(code, { studio_version, place_id, job_id });

  // Recycle builds that were sent but never confirmed (plugin restarted, network blip, etc.)
  db.revertStaleSentBuilds(code);

  const queued = db.getQueuedBuilds(code);
  const builds = queued.map((b) => ({
    id: b.id,
    system_name: b.system_name,
    files: JSON.parse(b.files),
  }));

  if (builds.length) {
    db.markBuildsSent(builds.map((b) => b.id));
  }

  res.json({
    connected: true,
    code,
    builds,
  });
});

/* ------------------------------------------------------------------ */
/* GET /api/studio/status/:code
   Polled by the Forge AI frontend to show real connection status. */
router.get("/status/:code", (req, res) => {
  const { code } = req.params;
  const session = db.getSession(code);
  const connected = db.isSessionConnected(session);
  const lastBuild = db.getLastBuild(code);
  const lastFailed = db.getLastFailedBuild(code);

  res.json({
    code,
    connected,
    last_seen: session ? session.last_seen : null,
    studio_version: session ? session.studio_version : null,
    place_id: session ? session.place_id : null,
    queued_count: db.countQueued(code),
    last_build: lastBuild
      ? {
          id: lastBuild.id,
          system_name: lastBuild.system_name,
          status: lastBuild.status,
          created_at: lastBuild.created_at,
          delivered_at: lastBuild.delivered_at,
        }
      : null,
    last_error: lastFailed ? lastFailed.error : null,
  });
});

/* ------------------------------------------------------------------ */
/* POST /api/studio/build
   Called by the Forge AI frontend's "SEND TO ROBLOX STUDIO" button.
   body: { code, system_name, files, project_id? } */
router.post("/build", (req, res) => {
  const { code, system_name, files, project_id } = req.body || {};
  if (!code || !system_name || !Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: "code, system_name and a non-empty files array are required" });
  }
  for (const f of files) {
    if (!f.path || !f.name || !f.type) {
      return res.status(400).json({ error: "each file needs path, name and type" });
    }
  }

  db.ensureConnectionCode(code, project_id || null);
  const build = db.createBuild({ code, project_id, system_name, files });

  const session = db.getSession(code);
  const connected = db.isSessionConnected(session);

  res.json({
    ok: true,
    build_id: build.id,
    status: build.status, // 'queued'
    connected, // tells the frontend whether to show "sent" vs "queued, waiting for Studio"
  });
});

/* ------------------------------------------------------------------ */
/* GET /api/studio/builds/:code
   Build history for a project/connection code. */
router.get("/builds/:code", (req, res) => {
  const { code } = req.params;
  const builds = db.listBuilds(code).map((b) => ({
    id: b.id,
    system_name: b.system_name,
    status: b.status,
    created_at: b.created_at,
    sent_at: b.sent_at,
    delivered_at: b.delivered_at,
    error: b.error,
    file_count: JSON.parse(b.files).length,
  }));
  res.json({ code, builds });
});

/* ------------------------------------------------------------------ */
/* POST /api/studio/build/:id/result
   Called by the Roblox Studio plugin after it finishes processing a build.
   body: { success, created: string[], errors: string[] } */
router.post("/build/:id/result", (req, res) => {
  const { id } = req.params;
  const build = db.getBuild(id);
  if (!build) return res.status(404).json({ error: "build not found" });

  const { success, created = [], errors = [] } = req.body || {};
  const updated = db.markBuildResult(id, { success: !!success, created, errors });

  res.json({
    ok: true,
    build_id: updated.id,
    status: updated.status,
  });
});

module.exports = router;

