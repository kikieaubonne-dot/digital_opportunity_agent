require("dotenv").config();
const express = require("express");
const cors = require("cors");
const studioRoutes = require("./routes/studio");
const generateRoutes = require("./routes/generate");

const app = express();
const PORT = process.env.PORT || 3000;

// CORS_ORIGIN accepts "*" or a comma-separated list of exact origins, e.g.
// "https://digital-opportunity-agent.vercel.app,http://localhost:5173"
const CORS_ORIGIN_RAW = process.env.CORS_ORIGIN || "*";
const ALLOWED_ORIGINS = CORS_ORIGIN_RAW.split(",").map((s) => s.trim()).filter(Boolean);

// Temporary diagnostic logging — logs every incoming request's method, path,
// and Origin header, BEFORE CORS is evaluated, so a request blocked by CORS
// still shows up here. Remove once the Vercel <-> Render connection is
// confirmed stable if you don't want this in production logs.
app.use((req, res, next) => {
  console.log(`[forge-ai] ${req.method} ${req.path} — Origin: ${req.headers.origin || "(none, e.g. curl or Roblox Studio)"}`);
  next();
});

const corsOptions = {
  origin(origin, callback) {
    // No Origin header = not a browser request (curl, server-to-server, or
    // Roblox Studio's HttpService, which is NOT subject to CORS at all) — always allow.
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes("*") || ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    console.warn(`[forge-ai] CORS rejected origin "${origin}" — allowed: ${ALLOWED_ORIGINS.join(", ")}`);
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: false, // frontend never sends cookies/credentials — keep this false and origin "*" valid together
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // explicit catch-all preflight handling, in addition to per-route handling

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
