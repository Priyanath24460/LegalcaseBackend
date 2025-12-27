import axios from "axios";

const EMBEDDING_SERVICE_URL = process.env.EMBEDDING_SERVICE_URL || "http://localhost:8000/embed";

/**
 * Generate embedding for a given text using FastAPI service
 * @param {string} text
 * @returns {Promise<number[]>} embedding vector
 */
export const generateEmbedding = async (text) => {
  try {
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

    const response = await axios.post(EMBEDDING_SERVICE_URL, {
      texts: [cleanText],
      model_name: "all-MiniLM-L6-v2"
    }, {
      timeout: 30000 // 30 seconds timeout
    });

    if (response.data && response.data.embeddings && response.data.embeddings.length > 0) {
      console.log(`✅ Successfully parsed embedding, length: ${response.data.embeddings[0].length}`);
      return response.data.embeddings[0];
    } else {
      throw new Error("Invalid response from embedding service");
    }
  } catch (error) {
    console.error("❌ Error generating embedding:", error.message);
    throw new Error(`Embedding generation failed: ${error.message}`);
  }
};
