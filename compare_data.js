import mongoose from "mongoose";
import Section from "./models/sectionModel.js";
import Case from "./models/caseModel.js";
import dotenv from "dotenv";

dotenv.config();

async function compareData() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB\n");

    // Get a section from MongoDB
    const mongoSection = await Section.findOne({}).lean();
    console.log("=== MONGODB SECTION (all fields) ===");
    console.log(JSON.stringify(mongoSection, null, 2));
    console.log("");

    // Check actual field names
    if (mongoSection) {
      console.log("=== FIELD NAMES ===");
      console.log("Available keys:", Object.keys(mongoSection));
      console.log("");
      
      // Get the case
      const mongoCase = await Case.findOne({ caseId: mongoSection.caseId });
      console.log("=== MONGODB CASE (for above section) ===");
      console.log("caseId:", mongoCase?.caseId);
      console.log("title:", mongoCase?.title);
      console.log("caseNumber:", mongoCase?.caseNumber);
      console.log("caseName:", mongoCase?.caseName);
    }

    await mongoose.disconnect();
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

compareData();
