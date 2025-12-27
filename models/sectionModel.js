import mongoose from "mongoose";

const sectionSchema = new mongoose.Schema({
  sectionId: {
    type: String,
    required: true,
    unique: true
  },
  caseId: {
    type: String,
    required: true,
    ref: 'Case'
  },
  text: {
    type: String,
    required: true
  },
  embedding: {
    type: [Number],
    required: true
  },
  sectionNumber: {
    type: Number,
    required: true
  },
  startChar: {
    type: Number
  },
  endChar: {
    type: Number
  },
  wordCount: {
    type: Number
  },
  sectionType: {
    type: String,
    enum: ['paragraph', 'header', 'list', 'table', 'other'],
    default: 'paragraph'
  }
}, {
  timestamps: true
});

// Index for faster searching
sectionSchema.index({ caseId: 1 });
sectionSchema.index({ sectionNumber: 1 });

const Section = mongoose.model("Section", sectionSchema);
export default Section;
