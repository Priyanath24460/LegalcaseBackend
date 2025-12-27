import mongoose from "mongoose";
import dotenv from "dotenv";
import Section from "./models/sectionModel.js";

dotenv.config();

const testSectionCreation = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      dbName: process.env.DB_NAME,
    });
    console.log("✅ MongoDB connected for testing");

    // Check existing sections
    const existingCount = await Section.countDocuments();
    console.log(`Existing sections in database: ${existingCount}`);

    // Test creating a section with unique ID
    const uniqueId = `test_section_${Date.now()}`;
    const testSection = {
      sectionId: uniqueId,
      caseId: "test_case_123",
      text: "This is a test section for debugging purposes.",
      embedding: [0.1, 0.2, 0.3, 0.4, 0.5], // Simple test embedding
      sectionNumber: 1,
      wordCount: 8
    };

    const createdSection = await Section.create(testSection);
    console.log("✅ Test section created:", createdSection._id);

    // Check total sections after creation
    const newCount = await Section.countDocuments();
    console.log(`Total sections after creation: ${newCount}`);

    // List recent sections
    const recentSections = await Section.find({}).sort({ createdAt: -1 }).limit(3);
    console.log("Recent sections:", recentSections.map(s => ({
      id: s._id,
      sectionId: s.sectionId,
      caseId: s.caseId,
      createdAt: s.createdAt
    })));

    process.exit(0);
  } catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
  }
};

testSectionCreation();