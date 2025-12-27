import { extractAndStorePDF } from "./services/pdfService.js";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const testPDFProcessing = async () => {
  try {
    // Connect to database first
    await mongoose.connect(process.env.MONGO_URI, {
      dbName: process.env.DB_NAME,
    });
    console.log("✅ MongoDB connected for testing");

    // Create a simple text file for testing
    const testFilePath = path.join(process.cwd(), "test.txt");

    // Create a simple text file that looks like a PDF for testing
    const dummyContent = `
This is a test legal document.

Case: Test Case v. Defendant

The plaintiff alleges that the defendant breached the contract by failing to deliver the goods on time.

Section 1: Introduction
This case involves a dispute over contractual obligations.

Section 2: Facts
The facts of the case are as follows: On January 1, 2023, the parties entered into an agreement.

Section 3: Arguments
The plaintiff argues that the defendant's delay caused significant damages.

Section 4: Conclusion
Based on the foregoing, the court should rule in favor of the plaintiff.
    `.trim();

    // Write dummy content to a file
    fs.writeFileSync(testFilePath, dummyContent);

    console.log("Testing PDF processing with dummy file...");

    const caseId = await extractAndStorePDF(testFilePath, "test_document.txt");

    console.log(`✅ PDF processed successfully! Case ID: ${caseId}`);

    // Clean up
    fs.unlinkSync(testFilePath);

  } catch (error) {
    console.error("❌ PDF processing test failed:", error);
  }
};

testPDFProcessing();