// Forge AI — Google Gemini proxy (free tier)
// Keeps the real API key server-side. Converts the Anthropic-style request
// the frontend sends ({model, max_tokens, system, messages}) into Gemini's
// format, and converts Gemini's response back into the shape the frontend
// expects ({ content: [{ type: "text", text }] }).

const express = require("express");
const router = express.Router();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-2.0-flash";

router.post("/", async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(500).json({
      error: "GEMINI_API_KEY is not configured on this backend. Add it on Render (Environment) and redeploy.",
    });
  }

  const { max_tokens, system, messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array is required" });
  }

  // Anthropic roles are "user"/"assistant" — Gemini expects "user"/"model".
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }],
  }));

  const body = {
    contents,
    generationConfig: { maxOutputTokens: max_tokens || 1000 },
  };
  if (system) {
    body.systemInstruction = { parts: [{ text: system }] };
  }

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    const data = await geminiRes.json();
    if (!geminiRes.ok) {
      return res.status(geminiRes.status).json(data);
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    res.json({ content: [{ type: "text", text }] });
  } catch (err) {
    console.error("[forge-ai] Gemini proxy error:", err);
    res.status(502).json({ error: "Failed to reach Gemini API: " + err.message });
  }
});

module.exports = router;
