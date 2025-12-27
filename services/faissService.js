import Section from "../models/sectionModel.js";
import { PythonShell } from "python-shell";
import path from "path";
import fs from "fs";
import axios from "axios";
import { generateEmbedding } from "./embeddingService.js";

const FAISS_INDEX_PATH = process.env.FAISS_INDEX_PATH || "legal_index.faiss";
const FAISS_METADATA_PATH = process.env.FAISS_METADATA_PATH || "legal_metadata.pkl";
const FAISS_SERVICE_URL = process.env.FAISS_SERVICE_URL || "http://127.0.0.1:8001/search";

// Helper function to run Python FAISS operations
const runPythonFAISS = async (operation, data = null) => {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), "..", "LegalcasePython", "faiss_operations.py");
    const pythonPath = process.env.PYTHON_PATH || "python";

    const args = [operation];

    // For operations with large data, write to temp file
    let tempFilePath = null;
    if (data && (operation === 'build' || operation === 'search' || operation === 'add_incremental')) {
      tempFilePath = path.join(process.cwd(), `temp_${operation}_${Date.now()}.json`);
      console.log(`Writing data to temp file: ${tempFilePath}`);
      fs.writeFileSync(tempFilePath, JSON.stringify(data));
      console.log(`Temp file written, size: ${fs.statSync(tempFilePath).size} bytes`);
      args.push(tempFilePath);
    } else if (data) {
      args.push(JSON.stringify(data));
    }

    const options = {
      mode: 'text',
      pythonPath: pythonPath,
      pythonOptions: ['-u'],
      scriptPath: path.dirname(scriptPath),
      args: args
    };

    PythonShell.run(path.basename(scriptPath), options, (err, results) => {
      // Clean up temp file
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }

      if (err) {
        console.error("Python script error:", err);
        reject(err);
        return;
      }

      try {
        const result = JSON.parse(results[0]);
        if (result.success) {
          resolve(result);
        } else {
          reject(new Error(result.error));
        }
      } catch (parseErr) {
        console.error("Failed to parse Python output:", results);
        reject(parseErr);
      }
    });
  });
};

export const buildOrLoadIndex = async () => {
  try {
    // Load existing FAISS index and metadata if available
    let index = null;
    let metadata = [];
    let existingIds = new Set();

    if (fs.existsSync(FAISS_INDEX_PATH) && fs.existsSync(FAISS_METADATA_PATH)) {
      console.log("📂 Loading existing FAISS index...");
      const loadResult = await runPythonFAISS("load");
      if (loadResult.success) {
        console.log(`✅ FAISS index loaded with ${loadResult.count} items`);
        // Note: We can't directly access the index object from Python,
        // so we'll need to rebuild incrementally
      } else {
        console.log("⚠️ Could not load existing index, will create new one");
      }
    }

    console.log("📚 Fetching all sections from MongoDB...");
    const allSections = await Section.find({}).sort({ createdAt: 1 }); // Sort by creation time

    if (allSections.length === 0) {
      console.log("No sections found in database - skipping index build");
      return { success: true, message: "No sections to index", count: 0 };
    }

    // Check which sections are already indexed by reading metadata file
    if (fs.existsSync(FAISS_METADATA_PATH)) {
      try {
        const metadataContent = fs.readFileSync(FAISS_METADATA_PATH, 'utf8');
        const existingMetadata = JSON.parse(metadataContent);
        existingIds = new Set(existingMetadata.map(m => m.sectionId));
        console.log(`Found ${existingIds.size} already indexed sections`);
      } catch (error) {
        console.log("Could not read existing metadata, will rebuild index");
        existingIds = new Set();
      }
    }

    // Find new sections that need to be indexed
    const newSections = allSections.filter(section => !existingIds.has(section.sectionId));
    console.log(`Found ${newSections.length} new sections to index`);

    if (newSections.length === 0) {
      console.log("✅ No new sections to add. Index is already up to date.");
      return { success: true, message: "Index is up to date", count: allSections.length };
    }

    // Prepare new embeddings data for Python script
    const newEmbeddingsData = newSections.map(section => ({
      embedding: section.embedding,
      sectionId: section.sectionId,
      caseId: section.caseId,
      text: section.text
    }));

    console.log(`🧠 Adding ${newSections.length} new sections to FAISS index...`);
    const result = await runPythonFAISS("add_incremental", newEmbeddingsData);
    console.log(`✅ Added ${newSections.length} new sections to FAISS (Total now = ${allSections.length}).`);

    return result;

  } catch (error) {
    console.error("Error in buildOrLoadIndex:", error);
    throw error;
  }
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
      console.log("Performing FAISS search...");
      const response = await axios.post(FAISS_SERVICE_URL, {
        embedding: queryEmbedding,
        top_k: topK
      }, {
        timeout: 30000 // 30 seconds timeout
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
      const response = await axios.post(FAISS_SERVICE_URL, {
        embedding: await generateEmbedding(query),
        top_k: topK * 2 // Get more results for reranking
      }, { timeout: 30000 });

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
