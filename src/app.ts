import express, { Request, Response } from "express";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";

import { validateIdentify } from "./middleware/validateRequest";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { identifyController } from "./controllers/identifyController";

const app = express();

// ── Security & Utility Middleware ────────────────────────────────────────────
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging (skip in test environment)
if (process.env.NODE_ENV !== "test") {
  app.use(morgan("combined"));
}

// Rate limiting - prevent abuse
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: {
    error: "Too Many Requests",
    message: "Too many requests from this IP, please try again later.",
    statusCode: 429,
  },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// ── Health Check ─────────────────────────────────────────────────────────────
app.get("/", (req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    service: "Bitespeed Identity Reconciliation",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({
    status: "healthy",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ── Core Endpoint ─────────────────────────────────────────────────────────────
app.post("/identify", validateIdentify, identifyController);

// ── Error Handling ────────────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
