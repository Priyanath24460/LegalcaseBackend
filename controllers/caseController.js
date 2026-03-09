import { extractPDFContent, extractTextContent, storePDFContent, storeTextContent } from "../services/pdfService.js";
import { buildOrLoadIndex, bulkAddToFaissIndex } from "../services/faissService.js";

// New endpoint: Preview PDF content before storing
export const previewPDF = async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file uploaded" });

    console.log(`📄 Previewing PDF: ${file.originalname}`);
    const extractedData = await extractPDFContent(file.path, file.originalname);
    
    // Store file path temporarily for later use
    const previewId = `preview_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // In a production system, you'd want to store this in Redis or a temporary collection
    // For now, we'll include the file path in the response (be careful with security)
    
    res.json({
      previewId,
      filePath: file.path, // Temporary - in production, store this securely
      fileName: file.originalname,
      // Backward compatibility
      title: extractedData.metadata.title,
      court: extractedData.metadata.court,
      year: extractedData.metadata.year,
      // Enhanced metadata
      caseName: extractedData.metadata.caseName,
      caseNumber: extractedData.metadata.caseNumber,
      judgmentDate: extractedData.metadata.judgmentDate,
      judges: extractedData.metadata.judges,
      caseType: extractedData.metadata.caseType,
      // File info
      totalSections: extractedData.sections.length,
      fileSize: extractedData.fileSize,
      sections: extractedData.sections.slice(0, 3), // Show first 3 sections as preview
      fullTextPreview: extractedData.fullText.substring(0, 1000) + (extractedData.fullText.length > 1000 ? '...' : '')
    });
  } catch (err) {
    console.error('Error in previewPDF:', err);
    res.status(500).json({ error: "Preview failed", details: err.message });
  }
};

// New endpoint: Preview pasted text content before storing
export const previewText = async (req, res) => {
  try {
    const { text, fileName } = req.body;
    
    if (!text || !text.trim()) {
      return res.status(400).json({ error: "No text provided" });
    }

    console.log(`📝 Previewing pasted text: ${fileName}`);
    console.log(`Text length: ${text.length} characters`);
    
    // Process the text similar to PDF processing
    const extractedData = await extractTextContent(text, fileName || "Pasted Text Document");
    
    // Store text temporarily for later use
    const previewId = `text_preview_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    res.json({
      previewId,
      text: text, // Store the original text
      fileName: fileName || "Pasted Text Document",
      isTextInput: true, // Flag to indicate this is text input
      // Backward compatibility
      title: extractedData.metadata.title,
      court: extractedData.metadata.court,
      year: extractedData.metadata.year,
      // Enhanced metadata
      caseName: extractedData.metadata.caseName,
      caseNumber: extractedData.metadata.caseNumber,
      judgmentDate: extractedData.metadata.judgmentDate,
      judges: extractedData.metadata.judges,
      caseType: extractedData.metadata.caseType,
      // File info
      totalSections: extractedData.sections.length,
      fileSize: text.length, // Use text length as "file size"
      sections: extractedData.sections.slice(0, 3), // Show first 3 sections as preview
      fullTextPreview: extractedData.fullText.substring(0, 1000) + (extractedData.fullText.length > 1000 ? '...' : '')
    });
  } catch (err) {
    console.error('Error in previewText:', err);
    res.status(500).json({ error: "Text preview failed", details: err.message });
  }
};

// New endpoint: Confirm and store the approved PDF content
export const confirmPDF = async (req, res) => {
  try {
    const { previewId, filePath, fileName, text, isTextInput, approvedMetadata } = req.body;
    
    if (!previewId || !fileName) {
      return res.status(400).json({ error: "Missing required fields for confirmation" });
    }

    if (isTextInput && !text) {
      return res.status(400).json({ error: "Missing text content for text input" });
    }

    if (!isTextInput && !filePath) {
      return res.status(400).json({ error: "Missing file path for file input" });
    }

    let caseId;

    if (isTextInput) {
      console.log(`✅ Confirming text storage: ${fileName}`);
      // Store the text content with any user-approved metadata changes
      caseId = await storeTextContent(text, fileName, approvedMetadata);
    } else {
      console.log(`✅ Confirming PDF storage: ${fileName}`);
      // Store the PDF content with any user-approved metadata changes
      caseId = await storePDFContent(filePath, fileName, approvedMetadata);
    }

    // Build or update FAISS index after successful upload
    try {
      console.log("Building FAISS index after document confirmation...");
      await buildOrLoadIndex();
      console.log("✅ FAISS index updated successfully");
    } catch (indexError) {
      console.error("⚠️ FAISS index build failed, but document was uploaded:", indexError.message);
      // Don't fail the upload if index building fails
    }

    res.json({ 
      message: isTextInput ? "Text content confirmed and stored successfully" : "PDF confirmed and stored successfully", 
      caseId 
    });
  } catch (err) {
    console.error('Error in confirmPDF:', err);
    res.status(500).json({ error: "Confirmation failed", details: err.message });
  }
};

// Original upload endpoint (kept for backward compatibility)
export const uploadPDF = async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file uploaded" });

    // Extract content first
    const extractedData = await extractPDFContent(file.path, file.originalname);
    
    // Store immediately (no preview)
    const caseId = await storePDFContent(file.path, file.originalname);

    // Build or update FAISS index after successful upload
    try {
      console.log("Building FAISS index after document upload...");
      await buildOrLoadIndex();
      console.log("✅ FAISS index updated successfully");
    } catch (indexError) {
      console.error("⚠️ FAISS index build failed, but document was uploaded:", indexError.message);
      // Don't fail the upload if index building fails
    }

    res.json({ message: "PDF uploaded and indexed", caseId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Upload failed" });
  }
};
