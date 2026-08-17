// Forge AI — Anthropic proxy
// Keeps the real API key server-side, as required by section 14 of the spec:
// Browser -> Forge Backend -> Anthropic API (never Browser -> Anthropic directly
// with an exposed key). Used only by the standalone frontend build — the
// Claude artifact preview has its own built-in proxy and doesn't need this route.

const express = require("express");
const router = express.Router();

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

router.post("/", async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: "ANTHROPIC_API_KEY is not configured on this backend. Add it to server/.env and restart the server.",
    });
  }

  const { model, max_tokens, system, messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array is required" });
  }

  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: model || "claude-sonnet-4-6",
        max_tokens: max_tokens || 1000,
        system,
        messages,
      }),
    });

    const data = await anthropicRes.json();
    if (!anthropicRes.ok) {
      return res.status(anthropicRes.status).json(data);
    }
    res.json(data);
  } catch (err) {
    console.error("[forge-ai] Anthropic proxy error:", err);
    res.status(502).json({ error: "Failed to reach Anthropic API: " + err.message });
  }
});

module.exports = router;
