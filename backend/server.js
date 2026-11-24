import "dotenv/config";
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

const allowedOrigins = (process.env.CLIENT_ORIGIN || "*")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("This website is not allowed to access the UBUBIKO API."));
  },
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "UBUBIKO SMART API",
    database: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
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

app.use(notFound);
app.use(errorHandler);

const port = Number(process.env.PORT) || 10000;

try {
  await connectDatabase();
  app.listen(port, "0.0.0.0", () => {
    console.log(`UBUBIKO SMART API is running on port ${port}`);
  });
} catch (error) {
  console.error("The API could not start:", error.message);
  process.exit(1);
}
