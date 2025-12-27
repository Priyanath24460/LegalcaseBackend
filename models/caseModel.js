import mongoose from "mongoose";

const caseSchema = new mongoose.Schema({
  caseId: {
    type: String,
    required: true,
    unique: true
  },
  title: {
    type: String,
    required: true
  },
  fileName: {
    type: String,
    required: true
  },
  uploadDate: {
    type: Date,
    default: Date.now
  },
  totalSections: {
    type: Number,
    default: 0
  },
  fileSize: {
    type: Number
  },
  fullText: {
    type: String
  },
  pdfGridfsId: {
    type: mongoose.Schema.Types.ObjectId
  },
  metadata: {
    court: String,
    year: Number,
    // Enhanced metadata fields
    caseName: String,
    caseNumber: String,
    judgmentDate: String,
    judges: [String],
    caseType: String
  }
}, {
  timestamps: true
});

const Case = mongoose.model("Case", caseSchema);
export default Case;
