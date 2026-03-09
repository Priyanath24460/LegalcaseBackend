import axios from "axios";

/**
 * Get the embedding service URL from environment
 * Read at runtime, not at import time
 */
const getEmbeddingServiceUrl = () => {
  const url = process.env.EMBEDDING_SERVICE_URL || "http://localhost:8000/embed";
  return url;
};

// Log once at first use
let hasLogged = false;
const logUrl = () => {
  if (!hasLogged) {
    console.log("🌐 EMBEDDING_SERVICE_URL:", getEmbeddingServiceUrl());
    hasLogged = true;
  }
};

/**
 * Generate embedding for a given text using FastAPI service with retry logic
 * @param {string} text
 * @param {number} retries - Number of retry attempts (default: 2)
 * @returns {Promise<number[]>} embedding vector
 */
export const generateEmbedding = async (text, retries = 2) => {
  const EMBEDDING_SERVICE_URL = getEmbeddingServiceUrl();
  
  try {
    logUrl(); // Log on first use
    
    // Clean the text to avoid issues - remove special characters and normalize
    const cleanText = text
      .replace(/[\r\n\t]/g, ' ')
      .replace(/[^\x20-\x7E]/g, ' ') // Remove non-ASCII characters
      .replace(/\s+/g, ' ')
      .trim();

    if (cleanText.length === 0) {
      console.log("❌ Text is empty after cleaning, using fallback");
      return Array.from({length: 768}, () => Math.random() * 0.1);
    }

    console.log(`🔤 Generating embedding for text (length: ${cleanText.length}): "${cleanText.substring(0, 50)}..."`);

    // Increased timeout to handle Render cold starts (free tier can take 50+ seconds)
    const response = await axios.post(EMBEDDING_SERVICE_URL, {
      texts: [cleanText],
      model_name: "all-MiniLM-L6-v2"
    }, {
      timeout: 90000 // 90 seconds timeout for cold starts
    });

    if (response.data && response.data.embeddings && response.data.embeddings.length > 0) {
      console.log(`✅ Successfully parsed embedding, length: ${response.data.embeddings[0].length}`);
      return response.data.embeddings[0];
    } else {
      throw new Error("Invalid response from embedding service");
    }
  } catch (error) {
    console.error("❌ Error generating embedding:");
    console.error("  Error message:", error.message);
    console.error("  Error code:", error.code);
    if (error.response) {
      console.error("  Response status:", error.response.status);
      console.error("  Response data:", JSON.stringify(error.response.data));
    }
    console.error("  Embedding URL:", EMBEDDING_SERVICE_URL);
    
    // Retry logic for timeout errors (cold start)
    if (error.code === 'ECONNABORTED' && retries > 0) {
      console.log(`🔄 Retrying... (${retries} attempts remaining)`);
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds before retry
      return generateEmbedding(text, retries - 1);
    }
    
    throw new Error(`Embedding generation failed: ${error.message} (URL: ${EMBEDDING_SERVICE_URL})`);
  }
};
