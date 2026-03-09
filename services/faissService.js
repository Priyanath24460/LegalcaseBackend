import Section from "../models/sectionModel.js";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import axios from "axios";
import { generateEmbedding } from "./embeddingService.js";

const FAISS_INDEX_PATH = process.env.FAISS_INDEX_PATH || "legal_index.faiss";
const FAISS_METADATA_PATH = process.env.FAISS_METADATA_PATH || "legal_metadata.pkl";

/**
 * Get the FAISS service URL from environment at runtime
 */
const getFaissServiceUrl = () => {
  return process.env.FAISS_SERVICE_URL || "http://127.0.0.1:8001";
};

/**
 * Get the base URL without /search endpoint
 */
const getFaissBaseUrl = () => {
  const url = getFaissServiceUrl();
  // Remove /search if it exists
  return url.replace(/\/search$/, '');
};

// Log once at first use
let hasFaissLogged = false;
const logFaissUrl = () => {
  if (!hasFaissLogged) {
    console.log("🌐 FAISS_SERVICE_URL:", getFaissServiceUrl());
    hasFaissLogged = true;
  }
};

// Helper function to run Python FAISS operations
const runPythonFAISS = async (operation, data = null) => {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), "python_scripts", "faiss_operations.py");
    const pythonPath = process.env.PYTHON_PATH || "python";

    const args = ["-u", scriptPath, operation];

    // For operations with large data, write to temp file
    let tempFilePath = null;
    if (data && (operation === 'build' || operation === 'rebuild' || operation === 'search' || operation === 'add_incremental')) {
      tempFilePath = path.join(process.cwd(), `temp_${operation}_${Date.now()}.json`);
      console.log(`Writing data to temp file: ${tempFilePath}`);
      fs.writeFileSync(tempFilePath, JSON.stringify(data), 'utf8');
      console.log(`Temp file written, size: ${fs.statSync(tempFilePath).size} bytes`);
      args.push(tempFilePath);
    } else if (data) {
      args.push(JSON.stringify(data));
    }

    console.log(`Executing: ${pythonPath} ${args.join(' ')}`);

    const pythonProcess = spawn(pythonPath, args);
    
    let stdoutData = '';
    let stderrData = '';

    pythonProcess.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderrData += data.toString();
      console.error(`[Python stderr]: ${data.toString()}`);
    });

    pythonProcess.on('close', (code) => {
      // Clean up temp file
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }

      if (code !== 0) {
        console.error(`Python process exited with code ${code}`);
        console.error(`stderr: ${stderrData}`);
        reject(new Error(`Python script failed with exit code ${code}`));
        return;
      }

      try {
        const result = JSON.parse(stdoutData.trim());
        if (result.success) {
          resolve(result);
        } else {
          reject(new Error(result.error));
        }
      } catch (parseErr) {
        console.error("Failed to parse Python output:", stdoutData);
        console.error("Parse error:", parseErr);
        reject(parseErr);
      }
    });

    pythonProcess.on('error', (err) => {
      // Clean up temp file
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
      console.error("Failed to start Python process:", err);
      reject(err);
    });
  });
};

/**
 * Ping FAISS service to wake it up (Render cold start)
 */
const wakeUpFaissService = async () => {
  try {
    const baseUrl = getFaissBaseUrl();
    console.log("🔔 Pinging FAISS service to wake it up...");
    
    await axios.get(`${baseUrl}/health`, { 
      timeout: 120000 // 2 minutes for cold start
    });
    
    console.log("✅ FAISS service is awake");
    return true;
  } catch (error) {
    console.log("⚠️ FAISS service wake-up failed:", error.message);
    return false;
  }
};

export const buildOrLoadIndex = async () => {
  try {
    console.log("📚 Fetching all sections from MongoDB...");
    const allSections = await Section.find({}).sort({ createdAt: 1 }); // Sort by creation time

    if (allSections.length === 0) {
      console.log("No sections found in database - skipping index build");
      return { success: true, message: "No sections to index", count: 0 };
    }

    console.log(`Found ${allSections.length} sections in MongoDB`);
    
    // Wake up FAISS service first
    await wakeUpFaissService();
    
    // Check current FAISS index status
    try {
      const baseUrl = getFaissBaseUrl();
      const statusResponse = await axios.get(`${baseUrl}/status`, { timeout: 30000 });
      const faissCount = statusResponse.data.document_count || 0;
      
      console.log(`📊 FAISS index has ${faissCount} documents, MongoDB has ${allSections.length}`);
      
      if (faissCount === allSections.length) {
        console.log("✅ FAISS index is already up to date");
        return { 
          success: true, 
          message: "Index is up to date", 
          count: allSections.length 
        };
      }
      
      // Rebuild index with all documents
      console.log("🔄 Rebuilding FAISS index to sync with MongoDB...");
      const documents = allSections.map(section => ({
        embedding: section.embedding,
        section_id: section.sectionId,
        case_id: section.caseId,
        text: section.text
      }));
      
      const rebuildResponse = await axios.post(`${baseUrl}/rebuild`, 
        { documents },
        { timeout: 180000 } // 3 minutes for rebuild (larger operations)
      );
      
      if (rebuildResponse.data.success) {
        console.log(`✅ FAISS index rebuilt successfully with ${rebuildResponse.data.total_count} documents`);
        return { 
          success: true, 
          message: "Index rebuilt successfully", 
          count: rebuildResponse.data.total_count 
        };
      }
      
    } catch (error) {
      console.error("⚠️ Error updating FAISS index:", error.message);
      console.log("💡 Documents are saved to MongoDB. FAISS may need manual sync.");
    }
    
    return { 
      success: true, 
      message: "Sections saved to MongoDB", 
      count: allSections.length 
    };

  } catch (error) {
    console.error("Error in buildOrLoadIndex:", error);
    // Don't throw error - allow document upload to succeed even if index check fails
    return { 
      success: true, 
      message: "Sections saved. Index check skipped.", 
      count: 0 
    };
  }
};

/**
 * Add a single section to FAISS index
 * @param {Object} section - Section object with embedding, sectionId, caseId, text
 */
export const addToFaissIndex = async (section) => {
  try {
    const baseUrl = getFaissBaseUrl();
    console.log(`📤 Adding section to FAISS: ${section.sectionId}`);
    
    const response = await axios.post(`${baseUrl}/add`, {
      embedding: section.embedding,
      section_id: section.sectionId,
      case_id: section.caseId,
      text: section.text
    }, {
      timeout: 30000
    });
    
    if (response.data.success) {
      console.log(`✅ Added to FAISS index. Total: ${response.data.total_count}`);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error(`⚠️ Failed to add to FAISS index: ${error.message}`);
    // Don't throw - allow document upload to continue even if FAISS update fails
    return false;
  }
};

/**
 * Add multiple sections to FAISS index at once (with retry logic)
 * @param {Array} sections - Array of section objects
 */
export const bulkAddToFaissIndex = async (sections) => {
  // Run asynchronously - don't block document upload
  setImmediate(async () => {
    const maxRetries = 3;
    let attempt = 0;
    
    while (attempt < maxRetries) {
      try {
        attempt++;
        const baseUrl = getFaissBaseUrl();
        console.log(`📤 Bulk adding ${sections.length} sections to FAISS (attempt ${attempt}/${maxRetries})`);
        
        // Wake up service first (important for Render cold starts)
        if (attempt === 1) {
          const isAwake = await wakeUpFaissService();
          if (!isAwake) {
            console.log("⚠️ FAISS service not responding, waiting before retry...");
            await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10s
            continue;
          }
        }
        
        const documents = sections.map(section => ({
          embedding: section.embedding,
          section_id: section.sectionId,
          case_id: section.caseId,
          text: section.text
        }));
        
        const response = await axios.post(`${baseUrl}/bulk-add`, {
          documents
        }, {
          timeout: 60000 // 1 minute (service should be warm now)
        });
        
        if (response.data.success) {
          console.log(`✅ Bulk added ${response.data.added_count} sections. Total: ${response.data.total_count}`);
          return true;
        }
        
        return false;
      } catch (error) {
        console.error(`⚠️ Attempt ${attempt} failed: ${error.message}`);
        
        if (attempt < maxRetries) {
          const delay = attempt * 15000; // 15s, 30s
          console.log(`⏳ Waiting ${delay/1000}s before retry...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          console.error(`❌ Failed to bulk add to FAISS after ${maxRetries} attempts`);
          console.log("💡 Documents are in MongoDB. FAISS will sync on next search or manual rebuild.");
        }
      }
    }
    
    return false;
  });
  
  // Return immediately - don't wait for FAISS
  console.log("📤 FAISS update initiated in background (non-blocking)");
  return true;
};

/**
 * Search for similar sections using FastAPI FAISS service
 * @param {string} query
 * @param {number} topK
 * @returns {Promise<{topSections: Array, topCases: Array}>}
 */
export const searchCases = async (query, topK = 10) => {
  try {
    // Check if we have any sections first
    const sectionCount = await Section.countDocuments();
    if (sectionCount === 0) {
      console.log("No sections found in database");
      return {
        topSections: [],
        topCases: []
      };
    }

    console.log(`Searching through ${sectionCount} sections for: "${query}"`);

    // Generate embedding for the query
    console.log("Generating embedding for query...");
    const queryEmbedding = await generateEmbedding(query);
    console.log(`Query embedding generated, length: ${queryEmbedding.length}`);

    // Try FAISS search first
    try {
      logFaissUrl(); // Log on first use
      console.log("Performing FAISS search...");
      const baseUrl = getFaissBaseUrl();
      const response = await axios.post(`${baseUrl}/search`, {
        embedding: queryEmbedding,
        top_k: topK
      }, {
        timeout: 90000 // 90 seconds timeout for Render cold starts
      });

      if (response.data && response.data.success && response.data.topSections?.length > 0) {
        console.log(`FAISS search completed: found ${response.data.topSections?.length || 0} sections`);

        // Log the most relevant results
        console.log("=== FAISS SEMANTIC SEARCH RESULTS ===");
        if (response.data.topSections && response.data.topSections.length > 0) {
          response.data.topSections.slice(0, 5).forEach((section, index) => {
            console.log(`RANK ${index + 1}: Section ID = ${section.sectionId}, Case ID = ${section.caseId}, Score = ${section.score?.toFixed(4) || 'N/A'}`);
          });
        }
        console.log(`Top Cases: ${response.data.topCases?.join(', ') || 'None'}`);
        console.log("=====================================");

        return {
          topSections: response.data.topSections || [],
          topCases: response.data.topCases || [],
          searchMethod: 'semantic'
        };
      }
    } catch (faissError) {
      console.log("FAISS search failed, falling back to hybrid search:", faissError.message);
    }

    // Fallback to hybrid search (semantic + keyword)
    console.log("Using hybrid search (semantic + keyword)...");
    return await hybridSearch(query, topK);

  } catch (error) {
    console.error("Error in searchCases:", error);
    // Final fallback to text search
    console.log("Falling back to text search due to error...");
    return await fallbackTextSearch(query, topK);
  }
};

// Hybrid search function combining semantic and keyword search
const hybridSearch = async (query, topK = 10) => {
  try {
    console.log("Performing hybrid search...");

    // Get semantic results from FAISS
    let semanticResults = [];
    try {
      const baseUrl = getFaissBaseUrl();
      const response = await axios.post(`${baseUrl}/search`, {
        embedding: await generateEmbedding(query),
        top_k: topK * 2 // Get more results for reranking
      }, { timeout: 90000 }); // 90 seconds timeout for Render cold starts

      if (response.data?.success) {
        semanticResults = response.data.topSections || [];
      }
    } catch (err) {
      console.log("Semantic search failed in hybrid mode");
    }

    // Get keyword results
    const allSections = await Section.find({}).limit(200); // Search through more sections
    const queryLower = query.toLowerCase();

    const keywordResults = allSections.map(section => {
      const textLower = section.text.toLowerCase();
      let keywordScore = 0;

      // Exact phrase match gets highest score
      if (textLower.includes(queryLower)) {
        keywordScore += 10;
      }

      // Individual word matches
      const queryWords = queryLower.split(' ').filter(word => word.length > 2);
      queryWords.forEach(word => {
        if (textLower.includes(word)) {
          keywordScore += 1;
        }
      });

      return {
        ...section.toObject(),
        keywordScore: keywordScore,
        semanticScore: 0, // Will be filled from semantic results
        combinedScore: keywordScore // Start with keyword score
      };
    }).filter(section => section.keywordScore > 0);

    // Combine semantic and keyword scores
    const combinedResults = keywordResults.map(section => {
      // Find matching semantic result
      const semanticMatch = semanticResults.find(s => s.sectionId === section.sectionId);
      if (semanticMatch) {
        section.semanticScore = semanticMatch.score || 0;
        // Combined score: 70% semantic + 30% keyword (normalized)
        section.combinedScore = (semanticMatch.score * 0.7) + (section.keywordScore / 10 * 0.3);
      } else {
        // No semantic match, rely on keyword score
        section.combinedScore = section.keywordScore / 10 * 0.3;
      }
      return section;
    });

    // Sort by combined score and take top K
    const topResults = combinedResults
      .sort((a, b) => b.combinedScore - a.combinedScore)
      .slice(0, topK);

    // Add ranks
    topResults.forEach((section, index) => {
      section.rank = index + 1;
    });

    // Get unique case IDs
    const topCases = [...new Set(topResults.map(section => section.caseId))];

    console.log("=== HYBRID SEARCH RESULTS ===");
    topResults.slice(0, 5).forEach((section, index) => {
      console.log(`RANK ${index + 1}: Section ID = ${section.sectionId}, Case ID = ${section.caseId}`);
      console.log(`         Semantic Score = ${section.semanticScore?.toFixed(4) || 'N/A'}, Keyword Score = ${section.keywordScore}, Combined = ${section.combinedScore?.toFixed(4) || 'N/A'}`);
    });
    console.log(`Top Cases: ${topCases.join(', ')}`);
    console.log("============================");

    return {
      topSections: topResults,
      topCases: topCases,
      searchMethod: 'hybrid'
    };

  } catch (error) {
    console.error("Error in hybrid search:", error);
    return await fallbackTextSearch(query, topK);
  }
};

// Fallback text search function
const fallbackTextSearch = async (query, topK = 10) => {
  try {
    console.log("Using fallback text search...");

    const allSections = await Section.find({}).limit(100); // Limit for performance
    const queryLower = query.toLowerCase();

    // Score sections based on text similarity
    const scoredSections = allSections.map(section => {
      const textLower = section.text.toLowerCase();
      let score = 0;

      // Simple scoring based on word matches
      const queryWords = queryLower.split(' ').filter(word => word.length > 2);
      queryWords.forEach(word => {
        if (textLower.includes(word)) {
          score += 1;
        }
      });

      // Boost score for exact phrase matches
      if (textLower.includes(queryLower)) {
        score += 5;
      }

      return {
        ...section.toObject(),
        score: score,
        rank: 0 // Will be set after sorting
      };
    }).filter(section => section.score > 0) // Only return sections with matches
      .sort((a, b) => b.score - a.score) // Sort by score descending
      .slice(0, topK); // Take top K

    // Add ranks
    scoredSections.forEach((section, index) => {
      section.rank = index + 1;
    });

    // Get unique case IDs
    const topCases = [...new Set(scoredSections.map(section => section.caseId))];

    console.log(`Fallback search found ${scoredSections.length} matching sections from ${topCases.length} cases`);

    return {
      topSections: scoredSections,
      topCases: topCases,
      searchMethod: 'text'
    };

  } catch (error) {
    console.error("Error in fallback text search:", error);
    return {
      topSections: [],
      topCases: [],
      searchMethod: 'error'
    };
  }
};
