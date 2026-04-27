// Load config FIRST (dotenv)
import "./config.js";

import express from "express";
import cors from "cors";
import mongoose from "mongoose";

import caseRoute from "./routes/caseRoute.js";
import queryRoute from "./routes/queryRoute.js";
import geminiTestRoute from "./routes/geminiTestRoute.js";
import testMetadataRoute from "./routes/testMetadataRoute.js";

const app = express();

/**
 * =========================
 * ✅ CORS (PRODUCTION SAFE)
 * =========================
 */

const allowedOrigins = [
  "https://lawknow.vercel.app",
  "http://localhost:5173"
];

const corsOptions = {
  origin: function (origin, callback) {
    console.log("Incoming Origin:", origin);

    // Allow server-to-server / mobile apps / curl
    if (!origin) return callback(null, true);

    // Allow only trusted origins
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // ❗ DO NOT throw error (prevents missing headers issue)
    return callback(null, false);
  },

  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
};

// Apply CORS globally
app.use(cors(corsOptions));

/**
 * =========================
 * ✅ HANDLE PRE-FLIGHT
 * =========================
 * IMPORTANT: MUST NOT use "*" with Express 5/router
 */
app.options("*", cors(corsOptions));

/**
 * =========================
 * MIDDLEWARE
 * =========================
 */
app.use(express.json());

/**
 * =========================
 * DATABASE
 * =========================
 */
mongoose.connect(process.env.MONGO_URI, {
  dbName: process.env.DB_NAME,
})
.then(() => console.log("✅ MongoDB connected"))
.catch((err) => console.error("❌ MongoDB error:", err));

/**
 * =========================
 * ROUTES
 * =========================
 */
app.use("/api/cases", caseRoute);
app.use("/api/query", queryRoute);
app.use("/api/test", geminiTestRoute);
app.use("/api/test-metadata", testMetadataRoute);

/**
 * =========================
 * SERVER START
 * =========================
 */
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});