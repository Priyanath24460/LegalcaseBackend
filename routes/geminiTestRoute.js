import express from "express";
import { summarizeCase } from "../services/geminiService.js";

const router = express.Router();

// Test route for Gemini API
router.get("/test-gemini", async (req, res) => {
  const prompt = "Summarize the legal importance of the right to a fair trial in plain English.";
  try {
    const summary = await summarizeCase(prompt);
    res.json({ summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
