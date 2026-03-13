import { searchCases } from "../services/faissService.js";
import { summarizeCase, rewriteQuestion, rankCasesRelevance } from "../services/geminiService.js";
import Case from "../models/caseModel.js";
import { validateAndSanitize } from "../utils/questionValidator.js";

export const searchQuestion = async (req, res) => {
  try {
    const { question } = req.body;
    console.log("[searchQuestion] Query received:", question);

    // Validate and sanitize the question
    const validation = validateAndSanitize(question);
    
    if (!validation.isValid) {
      console.log("[searchQuestion] Invalid question:", validation.errors);
      return res.status(400).json({
        error: "Invalid question",
        message: validation.message,
        details: validation.errors,
        topSections: [],
        topCases: [],
        summary: validation.message
      });
    }

    // Show warning if present but continue processing
    if (validation.warning) {
      console.log("[searchQuestion] Warning:", validation.warning);
    }

    // Use the sanitized question for processing
    const sanitizedQuestion = validation.question;
    console.log("[searchQuestion] Sanitized query:", sanitizedQuestion);

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
      const searchResult = await searchCases(sanitizedQuestion);
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

    // Find most relevant case using frequency + score tiebreaker
    // Calculate weighted relevance score for each case
    // Combines: (1) number of sections, (2) total relevance score, (3) best score
    const caseStats = {};
    
    console.log(`[searchQuestion] Analyzing ${topSections.length} sections for case selection`);
    topSections.forEach((sec, idx) => {
      const caseId = sec.caseId;
      if (!caseStats[caseId]) {
        caseStats[caseId] = {
          count: 0,
          totalScore: 0,
          bestScore: 0,
          sections: []
        };
      }
      caseStats[caseId].count += 1;
      caseStats[caseId].totalScore += (sec.score || 0);
      caseStats[caseId].bestScore = Math.max(caseStats[caseId].bestScore, sec.score || 0);
      caseStats[caseId].sections.push({ index: idx, sectionId: sec.sectionId, score: sec.score });
      
      console.log(`[searchQuestion]   Section ${idx}: caseId = ${caseId}, score = ${sec.score?.toFixed(4)}`);
    });

    console.log("[searchQuestion] Case statistics:", JSON.stringify(caseStats, null, 2));

    // Get the top 3 candidate cases first
    const initialTop3CaseIds = Object.keys(caseStats)
      .map(caseId => ({
        caseId,
        bestScore: caseStats[caseId].bestScore,
        count: caseStats[caseId].count,
        totalScore: caseStats[caseId].totalScore
      }))
      .sort((a, b) => {
        if (Math.abs(b.bestScore - a.bestScore) > 0.001) {
          return b.bestScore - a.bestScore;
        }
        if (b.count !== a.count) {
          return b.count - a.count;
        }
        return b.totalScore - a.totalScore;
      })
      .slice(0, 3)
      .map(item => item.caseId);

    console.log("[searchQuestion] Initial FAISS ranking:", initialTop3CaseIds.map(caseId => ({
      caseId,
      bestScore: caseStats[caseId].bestScore.toFixed(4),
      count: caseStats[caseId].count,
      totalScore: caseStats[caseId].totalScore.toFixed(4)
    })));

    console.log(`[searchQuestion] Selected top 3 cases (by FAISS score): ${initialTop3CaseIds.join(', ')}`);
    console.log("[searchQuestion] Top 5 sections used for answer:", topSections.slice(0, 5).map((s, idx) => ({
      index: idx,
      sectionId: s.sectionId,
      caseId: s.caseId,
      score: s.score?.toFixed(4)
    })));

    // Get case details with full text for all top 3 cases
    const selectedCases = [];
    try {
      for (const caseId of initialTop3CaseIds) {
        const caseDoc = await Case.findOne({ caseId });
        console.log("[searchQuestion] MongoDB query result:", {
          caseIdQueried: caseId,
          foundCase: caseDoc ? {
            caseId: caseDoc.caseId,
            title: caseDoc.title,
            year: caseDoc.metadata?.year,
            hasFullText: !!caseDoc.fullText,
            fullTextLength: caseDoc.fullText?.length || 0
          } : null
        });
        if (caseDoc && caseDoc.fullText) {
          selectedCases.push(caseDoc);
        } else {
          console.warn(`[searchQuestion] Case ${caseId} not found or has no fullText, skipping...`);
        }
      }
      
      if (selectedCases.length === 0) {
        console.warn(`[searchQuestion] No valid cases found from top 3`);
        return res.status(404).json({ error: "Selected cases not found in database" });
      }
    } catch (err) {
      console.error(`[searchQuestion] Error fetching case details:`, err);
      return res.status(500).json({ error: "Case lookup failed", details: err.message });
    }

    // Now re-rank the selected cases using AI for better relevance assessment
    console.log("\n[searchQuestion] ===== AI RE-RANKING PHASE =====");
    console.log(`[searchQuestion] Initial FAISS order: ${selectedCases.map(c => c.caseId).join(', ')}`);
    
    let aiRankedCaseIds = [];
    try {
      aiRankedCaseIds = await rankCasesRelevance(sanitizedQuestion, selectedCases);
      console.log(`[searchQuestion] ✅ AI re-ranked cases: ${aiRankedCaseIds.join(', ')}`);
    } catch (err) {
      console.error(`[searchQuestion] AI ranking failed, using FAISS order:`, err.message);
      aiRankedCaseIds = selectedCases.map(c => c.caseId);
    }
    console.log("[searchQuestion] =================================\n");

    // Reorder selectedCases based on AI ranking
    const reorderedSelectedCases = aiRankedCaseIds
      .map(caseId => selectedCases.find(c => c.caseId === caseId))
      .filter(c => c !== undefined);

    // Use the AI-reordered cases for final processing
    const top3CaseIds = reorderedSelectedCases.map(c => c.caseId);

    // Generate summaries for all selected cases
    const caseSummaries = [];
    
    for (let i = 0; i < reorderedSelectedCases.length; i++) {
      const selectedCase = reorderedSelectedCases[i];
      const relevantSections = topSections.filter(s => s.caseId === selectedCase.caseId).slice(0, 5);

      console.log(`\n=== PROCESSING CASE ${i + 1} OF ${selectedCases.length} ===`);
      console.log(`Case ID: ${selectedCase.caseId}`);
      console.log(`Title: ${selectedCase.title}`);
      console.log(`Court: ${selectedCase.metadata?.court || 'N/A'}`);
      console.log(`Year: ${selectedCase.metadata?.year || 'N/A'}`);
      console.log(`Full Text Length: ${selectedCase.fullText.length} characters`);
      console.log(`Top Matching Sections: ${relevantSections.length}`);
      relevantSections.forEach((section, index) => {
        console.log(`  Section ${index + 1}: Score = ${section.score?.toFixed(4) || 'N/A'}`);
      });
      console.log("====================================");

      // Build context with FULL CASE TEXT (not just sections)
      const context = `=== FULL CASE DOCUMENT ===

Case Title: ${selectedCase.title || 'Unknown'}
Case Number: ${selectedCase.metadata?.caseNumber || 'N/A'}
Court: ${selectedCase.metadata?.court || 'Unknown Court'}
Year: ${selectedCase.metadata?.year || 'N/A'}
Judges: ${Array.isArray(selectedCase.metadata?.judges) ? selectedCase.metadata.judges.join(', ') : 'N/A'}
Case Type: ${selectedCase.metadata?.caseType || 'N/A'}

=== COMPLETE CASE TEXT ===

${selectedCase.fullText}

=== END OF CASE ===`;

      console.log(`\n=== FULL TEXT BEING SENT TO AI (Case ${i + 1}) ===`);
      console.log(`Full Text Length: ${selectedCase.fullText.length} characters`);
      console.log(`Full Text Preview (first 500 chars):\n${selectedCase.fullText.substring(0, 500)}...`);
      console.log(`\nFull Text Preview (last 300 chars):\n...${selectedCase.fullText.substring(selectedCase.fullText.length - 300)}`);
      console.log("====================================\n");
      
      console.log(`[searchQuestion] Full case context for Gemini (length: ${context.length} characters)`);
      console.log(`[searchQuestion] Complete context being sent to AI:\n${context.substring(0, 800)}...\n...${context.substring(context.length - 300)}`);
       
      // Question-focused prompt that directly answers user queries with FULL CASE
      const prompt = `
You are an AI legal reasoning assistant designed to analyze Sri Lankan court judgments.

Your task is to answer the user's legal question by reasoning strictly from the SINGLE court case provided below.

==================================================
STRICT SOURCE LIMITATION
==================================================

You are allowed to rely ONLY on the information contained in the case document provided.

You MUST NOT use:
- Outside legal knowledge
- General knowledge of Sri Lankan law
- Other court cases
- Legal doctrines not explicitly mentioned in the case
- Assumptions or speculation

If the user's question cannot be clearly answered using the case provided, you MUST explicitly say:

"The provided case does not clearly address this specific issue."

Do not attempt to guess or expand the law beyond what appears in the judgment.

==================================================
PRIMARY OBJECTIVE
==================================================

Your goal is to help a user understand how the court’s reasoning in this case may relate to their situation.

The DIRECT ANSWER section must be written clearly for a non-lawyer citizen.  
Use simple language and avoid unnecessary legal jargon.

==================================================
USER QUESTION
==================================================

${sanitizedQuestion}

==================================================
CASE DOCUMENT PROVIDED
==================================================

${context}

==================================================
REQUIRED ANALYSIS PROCESS
==================================================

1. Carefully read the entire case document.
2. Identify the following elements from the judgment:
   - Material facts relevant to the issue
   - The legal issue decided by the court
   - The court’s holding
   - The reasoning used by the court (ratio decidendi)
3. Focus only on facts relevant to the user’s question.
4. Ignore irrelevant background or procedural details unless necessary.
5. Do NOT expand the legal rule beyond what the court actually stated.

If the user's scenario appears materially different from the facts of the case, clearly explain the limitation.

==================================================
RESPONSE FORMAT
==================================================

🎯 DIRECT ANSWER

Provide a clear answer to the user's question in 2–4 sentences.

Explain whether the court's reasoning in this case suggests the user might be able to succeed or not.

Write in simple language understandable to a non-lawyer.

───────────────────────────────────────────────

📖 Legal Basis From This Case

Case Name: (Use the exact title from metadata)  
Court: (From metadata)  
Year: (From metadata)  
Citation: (If available)

Relevant Material Facts:

Describe only the facts necessary to understand the issue decided in the case.

Legal Issue Decided:

State the precise legal question the court determined.

Court’s Holding:

Explain what the court ultimately decided.

Reasoning (Ratio Decidendi):

Explain the reasoning used by the court to reach its decision.  
This must strictly reflect reasoning found in the judgment.

───────────────────────────────────────────────

💡 Application To the User’s Question

Explain how the court’s decision may apply if the user’s situation is similar to the case.

If the user’s situation may differ from the facts of the case, clearly explain that limitation.

If the case does not fully resolve the user's situation, state:

"This case may not fully apply if your factual situation differs in the following way: [explain differences based only on the case facts]."

───────────────────────────────────────────────

⚠️ Limitation

This answer is generated strictly from the single case provided above.  
No other legal sources or external knowledge have been used.

==================================================
WRITING RULES
==================================================

- Write in clear professional language
- Do not speculate
- Do not add legal rules not present in the case
- Do not include dramatic tone
- Do not produce textbook explanations
- Do not reference external law or cases
- Do not mention that you are an AI

Your task is to simulate careful legal reasoning based solely on the provided court judgment.
`;

      let summary;
      try {
        summary = await summarizeCase(prompt);
        console.log(`[searchQuestion] Gemini summary for case ${i + 1}:`, summary?.slice(0, 200) + (summary?.length > 200 ? '...' : ''));
      } catch (err) {
        console.error(`[searchQuestion] summarizeCase threw error for case ${i + 1}:`, err);
        summary = "Error generating summary for this case.";
      }

      caseSummaries.push({
        caseInfo: {
          caseId: selectedCase.caseId,
          title: selectedCase.title,
          court: selectedCase.metadata?.court,
          year: selectedCase.metadata?.year,
          citation: selectedCase.metadata?.citation,
          caseNumber: selectedCase.metadata?.caseNumber,
          caseType: selectedCase.metadata?.caseType,
          judges: selectedCase.metadata?.judges,
          fullTextLength: selectedCase.fullText?.length,
          rank: i + 1
        },
        summary,
        relevantSections
      });
    }

    res.json({
      topSections: caseSummaries[0]?.relevantSections || [],
      topCases: top3CaseIds,
      selectedCase: caseSummaries[0]?.caseInfo || null,
      allCases: caseSummaries,
      summary: caseSummaries[0]?.summary || "",
      searchMethod,
      message: "Answer based on top matching cases"
    });
  } catch (err) {
    console.error("[searchQuestion] Uncaught error:", err);
    res.status(500).json({
      error: "Search failed",
      details: err.message
    });
  }
};

/**
 * Rewrite user question using AI to make it more clear and meaningful
 */
export const rewriteUserQuestion = async (req, res) => {
  try {
    const { question } = req.body;
    console.log("[rewriteUserQuestion] Original question received:", question);

    // Basic validation
    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return res.status(400).json({
        error: "Invalid input",
        message: "Question is required"
      });
    }

    const trimmedQuestion = question.trim();

    // Don't rewrite if question is too short
    if (trimmedQuestion.length < 5) {
      return res.status(400).json({
        error: "Question too short",
        message: "Question must be at least 5 characters to rewrite"
      });
    }

    // Don't rewrite if question is too long
    if (trimmedQuestion.length > 1000) {
      return res.status(400).json({
        error: "Question too long",
        message: "Question is too long to rewrite (maximum 1000 characters)"
      });
    }

    // Call Gemini to rewrite the question
    const rewrittenQuestion = await rewriteQuestion(trimmedQuestion);

    console.log("[rewriteUserQuestion] Successfully rewrote question");

    return res.json({
      success: true,
      originalQuestion: trimmedQuestion,
      rewrittenQuestion: rewrittenQuestion,
      message: "Question rewritten successfully"
    });

  } catch (err) {
    console.error("[rewriteUserQuestion] Error:", err);
    
    // Handle rate limit errors specifically
    if (err.message === "RATE_LIMIT") {
      return res.status(429).json({
        error: "Rate limit exceeded",
        message: "Too many rewrite requests. Please wait a moment and try again.",
        retryAfter: 3000 // Suggest retry after 3 seconds
      });
    }
    
    // Handle other errors
    return res.status(500).json({
      error: "Rewrite failed",
      message: "Failed to rewrite question. Please try again later.",
      details: err.message
    });
  }
};
