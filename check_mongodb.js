import mongoose from "mongoose";
import Section from "./models/sectionModel.js";
import Case from "./models/caseModel.js";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/legal_case_finder";

async function checkData() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected to MongoDB\n");

    // Get sample sections
    const sections = await Section.find({}).limit(5);
    console.log("Sample SECTIONS from MongoDB:");
    sections.forEach((s, i) => {
      console.log(`${i+1}. SectionId: ${s.sectionId}`);
      console.log(`   CaseId: ${s.caseId}`);
      console.log(`   Text: ${s.text.substring(0, 80)}...`);
      console.log("");
    });

    // Get sample cases
    const cases = await Case.find({}).limit(5);
    console.log("\nSample CASES from MongoDB:");
    cases.forEach((c, i) => {
      console.log(`${i+1}. CaseId: ${c.caseId}`);
      console.log(`   Title: ${c.title}`);
      console.log(`   Case Number: ${c.caseNumber}`);
      console.log("");
    });

    await mongoose.disconnect();
  } catch (error) {
    console.error("Error:", error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

checkData();
