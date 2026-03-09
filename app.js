// Load config FIRST - this imports dotenv and runs config() before anything else
import "./config.js";

import express from "express";
import cors from "cors";
import mongoose from "mongoose";

import caseRoute from "./routes/caseRoute.js";
import queryRoute from "./routes/queryRoute.js";
import geminiTestRoute from "./routes/geminiTestRoute.js";
import testMetadataRoute from "./routes/testMetadataRoute.js";

const app = express();

// CORS configuration for production
const allowedOrigins = [
  'http://localhost:5173', // Local development
  'http://localhost:3000',
  process.env.FRONTEND_URL, // Production frontend URL
].filter(Boolean); // Remove undefined values

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1 || allowedOrigins.includes('*')) {
      return callback(null, true);
    }
    return callback(null, true); // For now, allow all origins
  },
  credentials: true
}));

app.use(express.json());

mongoose.connect(process.env.MONGO_URI, {
  dbName: process.env.DB_NAME,
}).then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error(err));


app.use("/api/cases", caseRoute);
app.use("/api/query", queryRoute);
app.use("/api/test", geminiTestRoute);
app.use("/api/test-metadata", testMetadataRoute);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
