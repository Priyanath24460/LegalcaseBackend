import express from "express";
import multer from "multer";
import { uploadPDF, previewPDF, previewText, confirmPDF } from "../controllers/caseController.js";

const router = express.Router();
const upload = multer({ dest: "uploads/" });

// New preview workflow
router.post("/preview", upload.single("pdf"), previewPDF);
router.post("/preview-text", previewText);
router.post("/confirm", confirmPDF);

// Original upload endpoint (backward compatibility)
router.post("/upload", upload.single("pdf"), uploadPDF);

export default router;
