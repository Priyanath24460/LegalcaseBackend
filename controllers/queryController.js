import { searchCases } from "../services/faissService.js";
import { summarizeCase } from "../services/geminiService.js";
import Case from "../models/caseModel.js";

export const searchQuestion = async (req, res) => {
  try {
    const { question } = req.body;
    console.log("[searchQuestion] Query received:", question);

    // Check if we have any sections in the database
    const Section = (await import("../models/sectionModel.js")).default;
    console.log("[searchQuestion] Section model imported");
    const totalSections = await Section.countDocuments();
    console.log("[searchQuestion] Total sections found:", totalSections);

    if (totalSections === 0) {
      console.log("[searchQuestion] No sections found, returning early");
      return res.json({
        topSections: [],
        topCases: [],
        summary: "No documents have been uploaded yet. Please upload some legal documents first before asking questions.",
        message: "No documents found"
      });
    }

    console.log("[searchQuestion] Calling searchCases...");
    let topSections, topCases, searchMethod;
    try {
      const searchResult = await searchCases(question);
      topSections = searchResult.topSections;
      topCases = searchResult.topCases;
      searchMethod = searchResult.searchMethod || 'unknown';
      console.log(`[searchQuestion] searchCases returned ${topSections?.length || 0} sections, ${topCases?.length || 0} cases using ${searchMethod} search`);
    } catch (err) {
      console.error("[searchQuestion] searchCases threw error:", err);
      return res.status(500).json({ error: "searchCases failed", details: err.message });
    }

    if (!topSections || topSections.length === 0) {
      console.log("[searchQuestion] No relevant sections found after searchCases");
      return res.json({
        topSections: [],
        topCases: [],
        summary: "No relevant information found in the uploaded documents for your question.",
        message: "No relevant results"
      });
    }

    // Find most relevant case (like Colab code)
    const caseCounter = {};
    topSections.forEach(sec => {
      caseCounter[sec.caseId] = (caseCounter[sec.caseId] || 0) + 1;
    });

    const mostCommonCaseId = Object.keys(caseCounter).reduce((a, b) =>
      caseCounter[a] > caseCounter[b] ? a : b
    );

    console.log(`[searchQuestion] Most relevant case: ${mostCommonCaseId}`);

    // Get case details
    let selectedCase;
    try {
      selectedCase = await Case.findOne({ caseId: mostCommonCaseId });
      if (!selectedCase) {
        console.warn(`[searchQuestion] No case found for caseId: ${mostCommonCaseId}`);
      }
    } catch (err) {
      console.error(`[searchQuestion] Error fetching case details for caseId ${mostCommonCaseId}:`, err);
      return res.status(500).json({ error: "Case lookup failed", details: err.message });
    }

    // Get top 5 sections from multiple cases for comprehensive answer
    const relevantSections = topSections.slice(0, 5);

    console.log("=== SECTIONS USED FOR SUMMARY ===");
    relevantSections.forEach((section, index) => {
      console.log(`Section ${index + 1}: ID = ${section.sectionId}, Case ID = ${section.caseId}, Score = ${section.score?.toFixed(4) || 'N/A'}`);
    });
    console.log("=================================");

    // Build enriched context with case information for better question answering
    const context = relevantSections.map((section, index) => {
      return `=== RELEVANT CASE ${index + 1} ===
Case ID: ${section.caseId}
Relevance Score: ${section.score ? (section.score * 100).toFixed(1) + '%' : 'N/A'}
Content: ${section.text}
`;
    }).join("\n\n");
    console.log(`[searchQuestion] Context for Gemini (length: ${context.length}):`, context.slice(0, 200) + (context.length > 200 ? '...' : ''));

    // Question-focused prompt that directly answers user queries
    const prompt = `
You are a Sri Lankan legal expert. Your ONLY job is to directly answer the user's specific question using the case law provided. 

**PRIMARY OBJECTIVE: ANSWER THE USER'S QUESTION FIRST AND FOREMOST**

**CRITICAL INSTRUCTIONS:**
- Start with a direct answer to the user's question
- Use ONLY the provided case law as evidence
- Focus on practical, actionable guidance
- Be specific about what the user should do or expect
- Connect every piece of case law directly to the user's question

------------------------------------
**USER'S SPECIFIC QUESTION:**
"${question}"

------------------------------------
**RELEVANT CASE LAW:**
${context}

------------------------------------
**REQUIRED RESPONSE FORMAT:**

# 🎯 **DIRECT ANSWER TO YOUR QUESTION**

## ✅ **SHORT ANSWER:**
Based on the case law provided: [Give a direct, clear answer to the user's question in 2-3 sentences]

## 📖 **LEGAL BASIS FOR THIS ANSWER:**
**Case(s) Used:** [Name the specific case(s)]
**What Happened:** [Only the facts relevant to the user's question]
**Court's Decision:** [Only the court ruling that relates to the user's question]

**Why This Applies to Your Question:** [Direct connection between case and user's situation]

---

## 💡 **WHAT THIS MEANS FOR YOU**

**Practical Answer:**
- [Specific guidance based on the case law]
- [What you can expect in your situation]
- [Your legal rights/position based on this precedent]

**Action Steps:**
- [Specific steps you should take]
- [What evidence/documents you might need]
- [Timeline considerations if any]

**⚠️ Important Considerations:**
- [Any limitations or differences from your exact situation]
- [Factors that could change the outcome]

---

## 🔍 **IF YOUR SITUATION IS SIMILAR**

**This Case Law Also Helps If:**
- [List similar situations where this applies]
- [Warning signs to watch for]

**When This Wouldn't Apply:**
- [Situations where this precedent doesn't help]  
- [Different circumstances that would need different legal approach]

---

**📌 DISCLAIMER:** This explanation is based solely on the provided case law context and should not be considered as legal advice. Always consult with a qualified lawyer for specific legal guidance.

------------------------------------
**FORMATTING RULES:**
- Always use the exact heading structure shown above
- Use emojis for visual appeal and clarity
- Use bullet points, numbered lists, and bold text
- Keep sentences short and clear
- Use "you/your" to address the user directly
- If context is insufficient, say: "⚠️ The provided context does not contain enough information about [specific topic], but here's what we can understand..."
`;


    let summary;
    try {
      summary = await summarizeCase(prompt);
      console.log(`[searchQuestion] Gemini summary:`, summary?.slice(0, 200) + (summary?.length > 200 ? '...' : ''));
    } catch (err) {
      console.error("[searchQuestion] summarizeCase threw error:", err);
      return res.status(500).json({ error: "summarizeCase failed", details: err.message });
    }

    res.json({
      topSections: relevantSections,
      topCases: [mostCommonCaseId],
      selectedCase: selectedCase ? {
        caseId: selectedCase.caseId,
        title: selectedCase.title,
        court: selectedCase.metadata?.court,
        year: selectedCase.metadata?.year,
        citation: selectedCase.metadata?.citation
      } : null,
      summary,
      searchMethod
    });
  } catch (err) {
    console.error("[searchQuestion] Uncaught error:", err);
    res.status(500).json({
      error: "Search failed",
      details: err.message
    });
  }
};
