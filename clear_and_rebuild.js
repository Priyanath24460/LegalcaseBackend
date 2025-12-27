import mongoose from "mongoose";
import dotenv from "dotenv";
import Case from "./models/caseModel.js";
import Section from "./models/sectionModel.js";
import { buildOrLoadIndex } from "./services/faissService.js";

dotenv.config();

const clearAndRebuild = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      dbName: process.env.DB_NAME,
    });
    console.log("✅ MongoDB connected");

    // Check current database state
    const caseCount = await Case.countDocuments();
    const sectionCount = await Section.countDocuments();
    
    console.log(`\n📊 Current database state:`);
    console.log(`   Cases: ${caseCount}`);
    console.log(`   Sections: ${sectionCount}`);

    // Ask for confirmation (in this case, we'll proceed automatically)
    console.log(`\n🗑️  Clearing all existing data...`);
    
    // Clear all sections
    const deletedSections = await Section.deleteMany({});
    console.log(`   Deleted ${deletedSections.deletedCount} sections`);
    
    // Clear all cases
    const deletedCases = await Case.deleteMany({});
    console.log(`   Deleted ${deletedCases.deletedCount} cases`);

    console.log(`\n✅ Database cleared successfully!`);
    console.log(`\nℹ️  To rebuild the index:`);
    console.log(`   1. Upload new documents through the web interface`);
    console.log(`   2. Or run: node check_db.js to see current state`);
    console.log(`   3. Or run the Python rebuild script if you have existing documents`);

    process.exit(0);
  } catch (error) {
    console.error("❌ Clear and rebuild failed:", error);
    process.exit(1);
  }
};

clearAndRebuild();