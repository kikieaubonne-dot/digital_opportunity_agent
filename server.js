require("dotenv").config();
const express = require("express");
const cors = require("cors");
const studioRoutes = require("./routes/studio");
const generateRoutes = require("./routes/generate");

const app = express();
const PORT = process.env.PORT || 3000;

const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
app.use(cors({ origin: CORS_ORIGIN }));

app.use(express.json({ limit: "5mb" })); // build payloads can carry a fair amount of Luau source

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "forge-ai-backend", time: Date.now() });
});

app.use("/api/studio", studioRoutes);
app.use("/api/generate", generateRoutes);

app.use((req, res) => {
  res.status(404).json({ error: "not found" });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("[forge-ai] error:", err);
  res.status(500).json({ error: "internal server error" });
});

app.listen(PORT, () => {
  console.log(`[forge-ai] backend listening on port ${PORT}`);
  console.log(`[forge-ai] CORS origin: ${CORS_ORIGIN}`);
});
