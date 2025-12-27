import express from "express";
import multer from "multer";
import { extractPDFContent } from "../services/pdfService.js";

const router = express.Router();
const upload = multer({ dest: "uploads/" });

// Test endpoint for metadata extraction
router.post("/test-metadata", upload.single("pdf"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file uploaded" });

    console.log(`🧪 Testing metadata extraction for: ${file.originalname}`);
    
    const extractedData = await extractPDFContent(file.path, file.originalname);
    
    res.json({
      success: true,
      filename: file.originalname,
      textLength: extractedData.fullText.length,
      sectionsCount: extractedData.sections.length,
      metadata: extractedData.metadata,
      textPreview: extractedData.fullText.substring(0, 500),
      firstSection: extractedData.sections[0] ? extractedData.sections[0].text.substring(0, 200) : "No sections found"
    });
    
  } catch (err) {
    console.error('Error in test-metadata:', err);
    res.status(500).json({ 
      success: false,
      error: err.message,
      stack: err.stack
    });
  }
});

export default router;