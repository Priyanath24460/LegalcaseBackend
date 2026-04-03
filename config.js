import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

export default {
  mongoUri: process.env.MONGO_URI,
  dbName: process.env.DB_NAME,
  geminiApiKeys: [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3
  ].filter(key => key), // Only include defined keys
  embeddingServiceUrl: process.env.EMBEDDING_SERVICE_URL,
  faissServiceUrl: process.env.FAISS_SERVICE_URL,
  pythonPath: process.env.PYTHON_PATH,
  faissIndexPath: process.env.FAISS_INDEX_PATH,
  faissMetadataPath: process.env.FAISS_METADATA_PATH,
  port: process.env.PORT || 3001,
  frontendUrl: process.env.FRONTEND_URL
};
