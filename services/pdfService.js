import fs from "fs";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdfParseModule = require("pdf-parse");
const pdfParse = typeof pdfParseModule === "function"
  ? pdfParseModule
  : typeof pdfParseModule.default === "function"
    ? pdfParseModule.default
    : typeof pdfParseModule.pdf === "function"
      ? pdfParseModule.pdf
      : null;

if (!pdfParse) {
  console.error("pdf-parse import error:", pdfParseModule);
  throw new Error("Could not resolve pdfParse function from pdf-parse module");
}
import Section from "../models/sectionModel.js";
import Case from "../models/caseModel.js";
import { generateEmbedding } from "./embeddingService.js";
import { extractMetadataWithAI } from "./geminiService.js";
import { bulkAddToFaissIndex } from "./faissService.js";
import mongoose from "mongoose";

// Extract text content directly (for pasted text)
export const extractTextContent = async (text, filename) => {
  try {
    console.log(`Starting text content extraction for: ${filename}`);
    console.log(`Text length: ${text ? text.length : 0} characters`);

    if (!text || text.trim().length === 0) {
      throw new Error('No text content provided');
    }

    // Clean up text - remove excessive whitespace but preserve structure
    const cleanedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    console.log("Text preprocessing completed");

    // Process the text using the same logic as PDF extraction
    const result = await processTextForMetadata(cleanedText, filename);
    
    return {
      ...result,
      fileSize: text.length // Use text length as file size
    };
    
  } catch (error) {
    console.error('Error in extractTextContent:', error);
    throw error;
  }
};

// Extract PDF content without storing to database (for preview)
export const extractPDFContent = async (filePath, filename) => {
  try {
    console.log(`Starting PDF content extraction for: ${filename}`);
    let text;

    // Check if it's a PDF or text file
    if (filename.toLowerCase().endsWith('.pdf')) {
      console.log("Processing as PDF file...");
      const dataBuffer = fs.readFileSync(filePath);
      const pdfData = await pdfParse(dataBuffer);
      text = pdfData.text;
      console.log(`PDF extracted, text length: ${text ? text.length : 0} characters`);
    } else {
      console.log("Processing as text file...");
      text = fs.readFileSync(filePath, 'utf8');
      console.log(`Text file read, length: ${text ? text.length : 0} characters`);
    }

    if (!text || text.trim().length === 0) {
      throw new Error('No text content found in file');
    }

    // Clean up text - remove excessive whitespace but preserve structure
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    console.log("Text preprocessing completed");

    // Process the text using shared function
    const result = await processTextForMetadata(text, filename);
    
    const fileStats = fs.statSync(filePath);
    
    return {
      ...result,
      fileSize: fileStats.size
    };
    
  } catch (error) {
    console.error('Error in extractPDFContent:', error);
    throw error;
  }
};

// Shared function to process text and extract metadata
const processTextForMetadata = async (text, filename) => {
  try {
    // Split text into sections - improved for legal documents
    const sections = [];
    
    // First try to split by paragraphs (double newlines)
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 50);
    
    if (paragraphs.length > 1) {
      // Use paragraphs if we have meaningful ones
      let currentSection = "";
      let sectionStart = 0;
      
      for (let i = 0; i < paragraphs.length; i++) {
        const para = paragraphs[i].trim();
        if (currentSection.length + para.length > 1500) {
          // Save current section
          if (currentSection.trim()) {
            sections.push({ 
              text: currentSection.trim(), 
              start: sectionStart, 
              end: sectionStart + currentSection.length 
            });
          }
          currentSection = para + " ";
          sectionStart = text.indexOf(para, sectionStart);
        } else {
          currentSection += para + " ";
        }
      }
      
      // Add remaining section
      if (currentSection.trim()) {
        sections.push({ 
          text: currentSection.trim(), 
          start: sectionStart, 
          end: sectionStart + currentSection.length 
        });
      }
    } else {
      // Fallback to sentence-based splitting
      const maxChars = 1200, overlap = 200;
      let start = 0, chunk = "";

      const sentences = text.split(/(?<=[.!?])\s+/);
      for (const s of sentences) {
        if (chunk.length + s.length <= maxChars) {
          chunk += s + " ";
        } else {
          if (chunk.trim()) {
            sections.push({ text: chunk.trim(), start, end: start + chunk.length });
          }
          chunk = chunk.slice(-overlap) + s + " ";
          start = start + chunk.length - overlap;
        }
      }
      if (chunk.trim()) {
        sections.push({ text: chunk.trim(), start, end: start + chunk.length });
      }
    }

    // Filter out very short sections
    const filteredSections = sections.filter(section => section.text.length > 100);

    // Primary metadata extraction using Gemini AI
    console.log("Starting enhanced metadata extraction with Gemini AI...");
    console.log("Text preview for metadata extraction:", text.substring(0, 1000));

    // Initialize metadata with defaults
    let extractedMetadata = {
      caseName: "Unknown Case",
      caseNumber: "",
      court: "Unknown Court",
      judgmentDate: "",
      year: new Date().getFullYear(),
      judges: [],
      caseType: "Unknown",
      title: "Unknown Title" // For backward compatibility
    };

    // Try Gemini AI first
    try {
      console.log("🤖 Using Gemini AI for comprehensive metadata extraction...");
      const aiMetadata = await extractMetadataWithAI(text);
      
      if (aiMetadata) {
        extractedMetadata = { ...extractedMetadata, ...aiMetadata };
        
        console.log("✅ Gemini AI extraction successful:");
        console.log("- Case Name:", extractedMetadata.caseName);
        console.log("- Case Number:", extractedMetadata.caseNumber);
        console.log("- Court:", extractedMetadata.court);
        console.log("- Judgment Date:", extractedMetadata.judgmentDate);
        console.log("- Year:", extractedMetadata.year);
        console.log("- Judges:", extractedMetadata.judges);
        console.log("- Case Type:", extractedMetadata.caseType);
      } else {
        console.log("⚠️ Gemini AI extraction returned no results, falling back to regex...");
        throw new Error("AI extraction failed");
      }
    } catch (aiError) {
      console.log("❌ Gemini AI extraction failed:", aiError.message);
      console.log("🔄 Falling back to basic regex extraction...");
      
      // Basic fallback to regex patterns for essential fields
      const titleMatch = text.match(/([A-Z][A-Za-z\s&.,()'-]+ v\.?\s+[A-Z][A-Za-z\s&.,()'-]+)/i) ||
                        text.match(/(Re\s+[A-Z][A-Za-z\s&.,()'-]+)/i) ||
                        text.match(/(In\s+the\s+matter\s+of\s+[A-Z][A-Za-z\s&.,()'-]+)/i);
      
      if (titleMatch) {
        extractedMetadata.caseName = titleMatch[0].replace(/\s+/g, ' ').trim().substring(0, 200);
        extractedMetadata.title = extractedMetadata.caseName;
        console.log("📝 Regex extracted case name:", extractedMetadata.caseName);
      }

      const courtMatch = text.match(/(Singapore\s+)?(Supreme\s+Court|High\s+Court|Court\s+of\s+Appeal|District\s+Court|Magistrate'?s\s+Court)/i) ||
                        text.match(/(Federal\s+Court|Court\s+of\s+Appeal|High\s+Court|Sessions?\s+Court)/i);
      
      if (courtMatch) {
        extractedMetadata.court = courtMatch[0].trim();
        console.log("🏛️ Regex extracted court:", extractedMetadata.court);
      }

      const yearMatch = text.match(/\[(\d{4})\]/) || text.match(/\b(18|19|20)(\d{2})\b/);
      if (yearMatch) {
        const foundYear = parseInt(yearMatch[1] || yearMatch[0]);
        if (foundYear >= 1800 && foundYear <= new Date().getFullYear()) {
          extractedMetadata.year = foundYear;
          console.log("📅 Regex extracted year:", extractedMetadata.year);
        }
      }


    }

    // Extract additional info from filename if available
    const namePart = filename.replace(/\.(pdf|txt)$/i, '');
    const parts = namePart.split(/[_-]/);

    // Extract year from filename if not found in content
    if (extractedMetadata.year === new Date().getFullYear()) { // If year is current year (default)
      for (const part of parts) {
        if (/^\d{4}$/.test(part)) {
          const fileYear = parseInt(part);
          if (fileYear >= 1800 && fileYear <= new Date().getFullYear()) {
            extractedMetadata.year = fileYear;
            console.log("Year extracted from filename:", extractedMetadata.year);
            break;
          }
        }
      }
    }

    // Use filename for case name if extraction failed
    if (extractedMetadata.caseName === "Unknown Case") {
      // Clean up filename to make it readable
      extractedMetadata.caseName = namePart
        .replace(/[_-]/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase()) // Title case
        .trim();
      extractedMetadata.title = extractedMetadata.caseName; // For backward compatibility
      console.log("Case name extracted from filename:", extractedMetadata.caseName);
    }

    // Try to extract court from filename if not found
    if (extractedMetadata.court === "Unknown Court") {
      const courtKeywords = ['HC', 'CA', 'SC', 'DC', 'MC', 'SGHC', 'SGCA', 'SGDC'];
      for (const part of parts) {
        if (courtKeywords.some(keyword => part.toUpperCase().includes(keyword))) {
          extractedMetadata.court = part.toUpperCase()
            .replace('SGHC', 'Singapore High Court')
            .replace('SGCA', 'Singapore Court of Appeal')
            .replace('SGDC', 'Singapore District Court')
            .replace('HC', 'High Court')
            .replace('CA', 'Court of Appeal')
            .replace('SC', 'Supreme Court')
            .replace('DC', 'District Court')
            .replace('MC', 'Magistrate Court');
          console.log("Court extracted from filename:", extractedMetadata.court);
          break;
        }
      }
    }

    console.log("Final enhanced metadata:");
    console.log("- Case Name:", extractedMetadata.caseName);
    console.log("- Case Number:", extractedMetadata.caseNumber);
    console.log("- Court:", extractedMetadata.court);
    console.log("- Judgment Date:", extractedMetadata.judgmentDate);
    console.log("- Year:", extractedMetadata.year);
    console.log("- Judges:", extractedMetadata.judges);
    console.log("- Case Type:", extractedMetadata.caseType);

    // Return extracted data without storing
    return {
      fullText: text,
      sections: filteredSections,
      metadata: {
        // Backward compatibility fields
        title: extractedMetadata.title,
        court: extractedMetadata.court,
        year: extractedMetadata.year,
        // Enhanced metadata fields
        caseName: extractedMetadata.caseName,
        caseNumber: extractedMetadata.caseNumber,
        judgmentDate: extractedMetadata.judgmentDate,
        judges: extractedMetadata.judges,
        caseType: extractedMetadata.caseType
      }
    };
  } catch (error) {
    console.error('Error in processTextForMetadata:', error);
    throw error;
  }
};

// Store PDF content to database (after user approval)
export const storePDFContent = async (filePath, filename, approvedMetadata = null) => {
  try {
    // First extract the content
    const extractedData = await extractPDFContent(filePath, filename);
    
    // Use approved metadata if provided, otherwise use extracted metadata
    const finalMetadata = approvedMetadata || extractedData.metadata;

    // Generate unique case ID
    const caseId = `case_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Store PDF in GridFS
    const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
      bucketName: 'pdfs'
    });

    const pdfStream = fs.createReadStream(filePath);
    const uploadStream = bucket.openUploadStream(filename, {
      metadata: {
        caseId: caseId,
        uploadDate: new Date()
      }
    });

    const pdfId = await new Promise((resolve, reject) => {
      pdfStream.pipe(uploadStream)
        .on('error', reject)
        .on('finish', () => resolve(uploadStream.id));
    });

    // Create case document with final metadata
    const caseDoc = await Case.create({
      caseId: caseId,
      title: finalMetadata.title || finalMetadata.caseName,
      fileName: filename,
      totalSections: extractedData.sections.length,
      fileSize: extractedData.fileSize,
      fullText: extractedData.fullText,
      pdfGridfsId: pdfId,
      metadata: {
        // Basic fields
        court: finalMetadata.court,
        year: finalMetadata.year,
        // Enhanced fields
        caseName: finalMetadata.caseName,
        caseNumber: finalMetadata.caseNumber,
        judgmentDate: finalMetadata.judgmentDate,
        judges: finalMetadata.judges || [],
        caseType: finalMetadata.caseType
      }
    });

    console.log(`Created case: ${caseId} with ${extractedData.sections.length} sections`);
    console.log(`Enhanced Metadata:`);
    console.log(`- Case Name: ${finalMetadata.caseName}`);
    console.log(`- Case Number: ${finalMetadata.caseNumber}`);
    console.log(`- Court: ${finalMetadata.court}`);
    console.log(`- Judgment Date: ${finalMetadata.judgmentDate}`);
    console.log(`- Year: ${finalMetadata.year}`);
    console.log(`- Judges: ${finalMetadata.judges ? finalMetadata.judges.join(', ') : 'None'}`);
    console.log(`- Case Type: ${finalMetadata.caseType}`);

    // Store sections with embeddings
    const createdSections = []; // Track created sections for bulk FAISS update
    
    for (let i = 0; i < extractedData.sections.length; i++) {
      console.log(`Processing section ${i + 1}/${extractedData.sections.length}...`);
      console.log(`Section ${i + 1} text length: ${extractedData.sections[i].text.length} characters`);
      console.log(`Section ${i + 1} preview: "${extractedData.sections[i].text.substring(0, 100).replace(/\n/g, ' ')}..."`);

      const sectionId = `${caseId}_sec_${i.toString().padStart(4, '0')}`;

      try {
        console.log(`Generating embedding for section ${i + 1}...`);
        console.log(`Section text length: ${extractedData.sections[i].text.length} characters`);
        console.log(`Section text preview: "${extractedData.sections[i].text.substring(0, 50)}..."`);

        const embedding = await generateEmbedding(extractedData.sections[i].text);
        console.log(`✅ Real embedding generated for section ${i + 1}, length: ${embedding.length}`);

        const sectionData = {
          sectionId: sectionId,
          caseId: caseId,
          text: extractedData.sections[i].text,
          embedding: embedding,
          sectionNumber: i + 1,
          startChar: extractedData.sections[i].start,
          endChar: extractedData.sections[i].end,
          wordCount: extractedData.sections[i].text.split(' ').length
        };

        console.log(`Creating section ${i + 1} in database...`);
        console.log(`Section data keys: ${Object.keys(sectionData).join(', ')}`);

        try {
          const createdSection = await Section.create(sectionData);
          console.log(`✅ Section ${i + 1} created successfully with ID: ${createdSection._id}`);
          console.log(`✅ Section saved: ${createdSection.sectionId}`);
          
          // Add to list for bulk FAISS update
          createdSections.push(createdSection);
        } catch (createError) {
          console.error(`❌ Failed to create section ${i + 1} in database:`, createError.message);
          console.error(`❌ Section data that failed:`, JSON.stringify(sectionData, null, 2));
          throw createError;
        }

      } catch (embError) {
        console.error(`❌ Error processing section ${i + 1}:`, embError.message);
        console.error(`❌ Error stack:`, embError.stack);
        console.error(`❌ Section text preview: "${extractedData.sections[i].text.substring(0, 100)}..."`);

        // Try to create section without embedding as fallback
        try {
          console.log(`🔄 Trying to create section ${i + 1} without embedding...`);
          const fallbackSectionData = {
            sectionId: sectionId,
            caseId: caseId,
            text: extractedData.sections[i].text,
            embedding: Array.from({length: 768}, () => Math.random() * 0.1), // Dummy embedding
            sectionNumber: i + 1,
            startChar: extractedData.sections[i].start,
            endChar: extractedData.sections[i].end,
            wordCount: extractedData.sections[i].text.split(' ').length
          };

          const fallbackSection = await Section.create(fallbackSectionData);
          console.log(`✅ Fallback section ${i + 1} created with ID: ${fallbackSection._id}`);
          
          // Add to list for bulk FAISS update (even with dummy embedding)
          createdSections.push(fallbackSection);
        } catch (fallbackError) {
          console.error(`❌ Even fallback section creation failed:`, fallbackError.message);
          throw fallbackError;
        }
      }
    }

    console.log(`✅ Successfully processed PDF: ${filename}`);
    
    // Bulk add all sections to FAISS index
    if (createdSections.length > 0) {
      console.log(`📤 Adding ${createdSections.length} sections to FAISS index...`);
      await bulkAddToFaissIndex(createdSections);
    }
    
    return caseId;
    
  } catch (error) {
    console.error('Error in storePDFContent:', error);
    throw error;
  }
};

// Store text content to database (for pasted text)
export const storeTextContent = async (text, filename, approvedMetadata = null) => {
  try {
    // First extract the content from text
    const extractedData = await extractTextContent(text, filename);
    
    // Use approved metadata if provided, otherwise use extracted metadata
    const finalMetadata = approvedMetadata || extractedData.metadata;

    // Generate unique case ID
    const caseId = `case_text_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Create case document with final metadata (no file storage needed for text)
    const caseDoc = await Case.create({
      caseId: caseId,
      title: finalMetadata.title || finalMetadata.caseName,
      fileName: filename,
      totalSections: extractedData.sections.length,
      fileSize: extractedData.fileSize,
      fullText: extractedData.fullText,
      // No pdfGridfsId for text input
      metadata: {
        // Basic fields
        court: finalMetadata.court,
        year: finalMetadata.year,
        // Enhanced fields
        caseName: finalMetadata.caseName,
        caseNumber: finalMetadata.caseNumber,
        judgmentDate: finalMetadata.judgmentDate,
        judges: finalMetadata.judges || [],
        caseType: finalMetadata.caseType
      }
    });

    console.log(`Created text case: ${caseId} with ${extractedData.sections.length} sections`);
    console.log(`Enhanced Metadata:`);
    console.log(`- Case Name: ${finalMetadata.caseName}`);
    console.log(`- Case Number: ${finalMetadata.caseNumber}`);
    console.log(`- Court: ${finalMetadata.court}`);
    console.log(`- Judgment Date: ${finalMetadata.judgmentDate}`);
    console.log(`- Year: ${finalMetadata.year}`);
    console.log(`- Judges: ${finalMetadata.judges ? finalMetadata.judges.join(', ') : 'None'}`);
    console.log(`- Case Type: ${finalMetadata.caseType}`);

    // Store sections with embeddings
    const createdSections = []; // Track created sections for bulk FAISS update
    
    for (let i = 0; i < extractedData.sections.length; i++) {
      console.log(`Processing section ${i + 1}/${extractedData.sections.length}...`);
      console.log(`Section ${i + 1} text length: ${extractedData.sections[i].text.length} characters`);
      console.log(`Section ${i + 1} preview: "${extractedData.sections[i].text.substring(0, 100).replace(/\n/g, ' ')}..."`);

      const sectionId = `${caseId}_sec_${i.toString().padStart(4, '0')}`;

      try {
        console.log(`Generating embedding for section ${i + 1}...`);
        console.log(`Section text length: ${extractedData.sections[i].text.length} characters`);
        console.log(`Section text preview: "${extractedData.sections[i].text.substring(0, 50)}..."`);

        const embedding = await generateEmbedding(extractedData.sections[i].text);
        console.log(`✅ Real embedding generated for section ${i + 1}, length: ${embedding.length}`);

        const sectionData = {
          sectionId: sectionId,
          caseId: caseId,
          text: extractedData.sections[i].text,
          embedding: embedding,
          sectionNumber: i + 1,
          startChar: extractedData.sections[i].start,
          endChar: extractedData.sections[i].end,
          wordCount: extractedData.sections[i].text.split(' ').length
        };

        console.log(`Creating section ${i + 1} in database...`);
        console.log(`Section data keys: ${Object.keys(sectionData).join(', ')}`);

        try {
          const createdSection = await Section.create(sectionData);
          console.log(`✅ Section ${i + 1} created successfully with ID: ${createdSection._id}`);
          console.log(`✅ Section saved: ${createdSection.sectionId}`);
          
          // Add to list for bulk FAISS update
          createdSections.push(createdSection);
        } catch (createError) {
          console.error(`❌ Failed to create section ${i + 1} in database:`, createError.message);
          console.error(`❌ Section data that failed:`, JSON.stringify(sectionData, null, 2));
          throw createError;
        }

      } catch (embError) {
        console.error(`❌ Error processing section ${i + 1}:`, embError.message);
        console.error(`❌ Error stack:`, embError.stack);
        console.error(`❌ Section text preview: "${extractedData.sections[i].text.substring(0, 100)}..."`);

        // Try to create section without embedding as fallback
        try {
          console.log(`🔄 Trying to create section ${i + 1} without embedding...`);
          const fallbackSectionData = {
            sectionId: sectionId,
            caseId: caseId,
            text: extractedData.sections[i].text,
            embedding: Array.from({length: 768}, () => Math.random() * 0.1), // Dummy embedding
            sectionNumber: i + 1,
            startChar: extractedData.sections[i].start,
            endChar: extractedData.sections[i].end,
            wordCount: extractedData.sections[i].text.split(' ').length
          };

          const fallbackSection = await Section.create(fallbackSectionData);
          console.log(`✅ Fallback section ${i + 1} created with ID: ${fallbackSection._id}`);
          
          // Add to list for bulk FAISS update (even with dummy embedding)
          createdSections.push(fallbackSection);
        } catch (fallbackError) {
          console.error(`❌ Even fallback section creation failed:`, fallbackError.message);
          throw fallbackError;
        }
      }
    }

    console.log(`✅ Successfully processed text content: ${filename}`);
    
    // Bulk add all sections to FAISS index
    if (createdSections.length > 0) {
      console.log(`📤 Adding ${createdSections.length} sections to FAISS index...`);
      await bulkAddToFaissIndex(createdSections);
    }
    
    return caseId;
    
  } catch (error) {
    console.error('Error in storeTextContent:', error);
    throw error;
  }
};

// Keep original function for backward compatibility
export const extractAndStorePDF = async (filePath, filename) => {
  return await storePDFContent(filePath, filename);
};
