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

// ✅ FIXED CORS CONFIG (stable + production-safe)
app.use(cors({
  origin: (origin, callback) => {

    console.log("Incoming Origin:", origin); // optional debug

    // Allow requests without origin (Postman, mobile apps, curl)
    if (!origin) return callback(null, true);

    // ✅ Allow frontend (Vercel + local)
    if (
      origin.includes("vercel.app") ||   // all Vercel deployments
      origin.includes("localhost")       // local dev
    ) {
      return callback(null, true);
    }

    // ❌ Block everything else
    return callback(new Error("CORS blocked: " + origin));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true
}));

// ✅ Handle preflight requests (VERY IMPORTANT)
app.options('*', cors());

// Middleware
app.use(express.json());

// MongoDB connection
mongoose.connect(process.env.MONGO_URI, {
  dbName: process.env.DB_NAME,
})
.then(() => console.log("✅ MongoDB connected"))
.catch((err) => console.error("❌ MongoDB error:", err));

// Routes
app.use("/api/cases", caseRoute);
app.use("/api/query", queryRoute);
app.use("/api/test", geminiTestRoute);
app.use("/api/test-metadata", testMetadataRoute);

// Server start
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});