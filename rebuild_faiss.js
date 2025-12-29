/**
 * Manual FAISS Index Rebuild Script
 * 
 * Run this script after uploading PDFs to ensure FAISS index
 * contains all sections from MongoDB
 * 
 * Usage: node rebuild_faiss.js
 */

import mongoose from "mongoose";
import Section from "./models/sectionModel.js";
import { buildOrLoadIndex } from "./services/faissService.js";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/legal_case_finder";

async function rebuildFAISS() {
  try {
    console.log("=".repeat(60));
    console.log("  FAISS INDEX REBUILD UTILITY");
    console.log("=".repeat(60));
    console.log("");

    // Connect to MongoDB
    console.log("📡 Connecting to MongoDB...");
    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected to MongoDB");
    console.log("");

    // Count sections in MongoDB
    const sectionCount = await Section.countDocuments();
    console.log(`📊 MongoDB Statistics:`);
    console.log(`   Total sections: ${sectionCount}`);
    console.log("");

    if (sectionCount === 0) {
      console.log("⚠️  No sections found in MongoDB. Nothing to rebuild.");
      await mongoose.disconnect();
      return;
    }

    // Get sample sections
    const sampleSections = await Section.find({}).limit(3);
    console.log(`📝 Sample sections:`);
    sampleSections.forEach((s, i) => {
      console.log(`   ${i + 1}. Section: ${s.sectionId}, Case: ${s.caseId}`);
      console.log(`      Text: ${s.text.substring(0, 80)}...`);
    });
    console.log("");

    // Rebuild FAISS index
    console.log("🔧 Rebuilding FAISS index...");
    console.log("");
    const result = await buildOrLoadIndex();
    console.log("");

    if (result.success) {
      console.log("=".repeat(60));
      console.log("✅ REBUILD COMPLETED SUCCESSFULLY");
      console.log("=".repeat(60));
      console.log(`   MongoDB sections: ${sectionCount}`);
      console.log(`   FAISS index items: ${result.count}`);
      
      if (result.count === sectionCount) {
        console.log("   ✅ Counts match! Index is fully synchronized.");
      } else {
        console.log("   ⚠️  Count mismatch! Please check for errors above.");
      }
      console.log("=".repeat(60));
    } else {
      console.log("❌ REBUILD FAILED");
      console.log(`   Error: ${result.error || 'Unknown error'}`);
    }

    // Disconnect
    await mongoose.disconnect();
    console.log("");
    console.log("👋 Disconnected from MongoDB");

  } catch (error) {
    console.error("❌ Error during rebuild:", error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run the rebuild
rebuildFAISS();
