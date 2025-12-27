import mongoose from "mongoose";
import dotenv from "dotenv";
import Case from "./models/caseModel.js";
import Section from "./models/sectionModel.js";

dotenv.config();

const checkDatabase = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      dbName: process.env.DB_NAME,
    });
    console.log("✅ MongoDB connected");

    // Check cases
    const cases = await Case.find({}).sort({ createdAt: -1 });
    console.log(`\n📁 Total cases: ${cases.length}`);
    cases.forEach((caseDoc, index) => {
      console.log(`${index + 1}. Case ID: ${caseDoc.caseId}`);
      console.log(`   Title: ${caseDoc.title}`);
      console.log(`   Sections: ${caseDoc.totalSections}`);
      console.log(`   Created: ${caseDoc.createdAt}`);
    });

    // Check sections
    const sections = await Section.find({}).sort({ createdAt: -1 });
    console.log(`\n📄 Total sections: ${sections.length}`);

    // Group sections by caseId
    const sectionsByCase = {};
    sections.forEach(section => {
      if (!sectionsByCase[section.caseId]) {
        sectionsByCase[section.caseId] = [];
      }
      sectionsByCase[section.caseId].push(section);
    });

    Object.keys(sectionsByCase).forEach(caseId => {
      console.log(`\nCase ${caseId}: ${sectionsByCase[caseId].length} sections`);
      sectionsByCase[caseId].slice(0, 2).forEach((section, idx) => {
        console.log(`  Section ${idx + 1}: ${section.sectionId} (${section.wordCount} words)`);
        console.log(`    Text: ${section.text.substring(0, 100)}...`);
      });
    });

    process.exit(0);
  } catch (error) {
    console.error("❌ Database check failed:", error);
    process.exit(1);
  }
};

checkDatabase();