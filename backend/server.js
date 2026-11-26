import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";
import { connectDatabase } from "./src/config/database.js";
import authRoutes from "./src/routes/auth.js";
import productRoutes from "./src/routes/products.js";
import stockRoutes from "./src/routes/stock.js";
import operationsRoutes from "./src/routes/operations.js";
import { notFound, errorHandler } from "./src/middleware/errors.js";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const clientFile = path.join(clientDir, "index.html");

// Exact origins and wildcard patterns (for example https://*.vercel.app) are both supported.
const normalizeOrigin = (value) => {
  const raw = String(value).trim().replace(/\/+$/, "");
  if (raw.includes("*")) return raw;
  try {
    return new URL(raw).origin;
  } catch {
    return raw;
  }
};

const defaultOrigins = [
  "https://genzura-ububiko-bwawe.vercel.app",
  // Vercel preview deployments use names like genzura-ububiko-bwawe-<hash>-<scope>.vercel.app.
  "https://genzura-ububiko-bwawe-*.vercel.app",
  "https://genzura-ububiko-bwawe.onrender.com",
  "https://ububikobwawe.netlify.app",
  "https://*--ububikobwawe.netlify.app",
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  process.env.RENDER_EXTERNAL_URL || ""
].filter(Boolean);

// CLIENT_ORIGIN adds to the defaults so a stale deployment value cannot lock out the live app.
const allowedOrigins = [...new Set(
  [...defaultOrigins, ...(process.env.CLIENT_ORIGIN || "").split(",")]
    .map(normalizeOrigin)
    .filter(Boolean)
)];

console.log(`Allowed browser origins: ${allowedOrigins.join(", ") || "(none)"}`);

const isOriginAllowed = (origin) => {
  if (!origin || allowedOrigins.includes("*")) return true;
  const normalized = normalizeOrigin(origin);
  return allowedOrigins.some((allowed) => {
    if (!allowed.includes("*")) return allowed === normalized;
    const pattern = allowed.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${pattern}$`, "i").test(normalized);
  });
};

// The single-file frontend uses inline scripts/styles, so the default CSP would block it.
app.use(helmet({ contentSecurityPolicy: false }));
const corsOptions = {
  origin(origin, callback) {
    if (isOriginAllowed(origin)) return callback(null, true);
    // Return false instead of throwing so CORS rejection is clear and does not mask as a server error.
    return callback(null, false);
  },
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204
};
// cors() handles OPTIONS preflight requests itself, including the POST /api/auth/login preflight.
app.use(cors(corsOptions));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  const databaseConnected = mongoose.connection.readyState === 1;
  res.status(databaseConnected ? 200 : 503).json({
    status: databaseConnected ? "ok" : "degraded",
    service: "UBUBIKO SMART API",
    database: databaseConnected ? "connected" : "disconnected",
    timestamp: new Date().toISOString()
  });
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Too many login attempts. Try again in 15 minutes." }
});

app.use("/api/auth/login", loginLimiter);
app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api", stockRoutes);
app.use("/api", operationsRoutes);

// Same-origin frontend. The /api routes above always take priority.
app.get(["/", "/index.html"], (_req, res, next) => {
  res.sendFile(clientFile, (error) => (error ? next(error) : undefined));
});

app.use(notFound);
app.use(errorHandler);

const port = Number(process.env.PORT) || 10000;

try {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must be set to a random value of at least 32 characters.");
  }
  await connectDatabase();
  app.listen(port, "0.0.0.0", () => {
    console.log(`UBUBIKO SMART API is running on port ${port}`);
  });
} catch (error) {
  console.error("The API could not start:", error.message);
  process.exit(1);
}
