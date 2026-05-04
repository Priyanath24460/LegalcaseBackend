import { searchCases } from "../services/faissService.js";
import { summarizeCase, rewriteQuestion, rankCasesRelevance, getBriefIdea } from "../services/geminiService.js";
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

    // ✅ IMPROVED: Multi-factor weighted scoring algorithm
    /**
     * Calculate relevance score using multiple factors
     * Weights: 40% avg + 30% best + 20% coverage + 10% authority
     */
    function calculateCaseRelevance(caseStatsObj) {
      const scored = {};
      
      for (const [caseId, stats] of Object.entries(caseStatsObj)) {
        // Calculate metrics
        const avgScore = stats.totalScore / stats.count;
        const bestScore = stats.bestScore;
        const sectionCount = stats.count;
        
        // Multi-factor weighted score
        // 40% = Average relevance (most important - overall quality)
        // 30% = Best single match (quality indicator - peak relevance)
        // 20% = Coverage (how many sections match - breadth)
        // 10% = Authority bonus (if applicable - precedent value)
        
        const relevanceScore = 
          (avgScore * 0.40) +              // Average relevance
          (bestScore * 0.30) +             // Best matching section
          (Math.min(sectionCount / 5, 1.0) * 0.20) +  // Coverage (normalized to 5)
          (getAuthorityBonus(caseId) * 0.10);         // Authority bonus
        
        scored[caseId] = {
          ...stats,
          avgScore,
          relevanceScore,
          breakdown: {
            avgScoreWeight: (avgScore * 0.40).toFixed(4),
            bestScoreWeight: (bestScore * 0.30).toFixed(4),
            coverageWeight: (Math.min(sectionCount / 5, 1.0) * 0.20).toFixed(4),
            authorityWeight: (getAuthorityBonus(caseId) * 0.10).toFixed(4)
          }
        };
      }
      
      // Sort by relevance score (descending)
      return Object.entries(scored)
        .sort((a, b) => b[1].relevanceScore - a[1].relevanceScore)
        .map(([caseId, stats]) => ({ caseId, ...stats }));
    }

    /**
     * Helper: Calculate authority bonus based on case metadata
     * Higher score if case is from higher court or more recent
     */
    function getAuthorityBonus(caseId) {
      // Default authority score
      // In future: could check case metadata for court level, year, etc.
      // For now: basic implementation = 0.5 (neutral)
      // This allows future enhancement without breaking current logic
      return 0.5;
    }

    // Get top 3 cases using improved weighted scoring
    const scoredCases = calculateCaseRelevance(caseStats);
    const initialTop3CaseIds = scoredCases
      .slice(0, 3)
      .map(c => c.caseId);

    console.log("[searchQuestion] ✅ IMPROVED: Multi-factor relevance scoring applied");
    console.log("[searchQuestion] Weighted case ranking:", scoredCases.slice(0, 3).map((c, idx) => ({
      rank: idx + 1,
      caseId: c.caseId,
      relevanceScore: c.relevanceScore.toFixed(4),
      avgScore: c.avgScore.toFixed(4),
      bestScore: c.bestScore.toFixed(4),
      coverage: c.count,
      breakdown: c.breakdown
    })));

    console.log(`[searchQuestion] Selected top 3 cases (by weighted relevance): ${initialTop3CaseIds.join(', ')}`);
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

    // Generate summaries/ideas for selected cases
    const caseSummaries = [];
    
    for (let i = 0; i < reorderedSelectedCases.length; i++) {
      const selectedCase = reorderedSelectedCases[i];
      const relevantSections = topSections.filter(s => s.caseId === selectedCase.caseId).slice(0, 5);

      console.log(`\n=== PROCESSING CASE ${i + 1} OF ${selectedCases.length} ===`);
      console.log(`Case ID: ${selectedCase.caseId}`);
      console.log(`Title: ${selectedCase.title}`);
      
      let summary;
      let isFullAnswer = false;

      // Only generate FULL summary for the BEST match (rank 1)
      if (i === 0) {
        console.log(`[searchQuestion] Generating FULL summary for BEST match (Case ${i + 1})`);
        
        // Build context with FULL CASE TEXT
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

        const prompt = `
You are an AI legal reasoning assistant designed to analyze Sri Lankan law and court judgments.

Your task is to answer the user's legal question by combining:
1. General legal principles of Sri Lankan law
2. The provided court case as supporting authority

==================================================
SOURCE USAGE RULES (CRITICAL)
==================================================

You may use:
- General legal principles of Sri Lankan law
- The provided case document

You MUST NOT:
- Invent case facts
- Misrepresent the judgment
- Cite cases not provided
- Speculate beyond available information

IMPORTANT:
- The case is NOT the only source of truth
- The case must be used as SUPPORTING AUTHORITY
- If the case does not fully answer the question, you MUST clearly say so

==================================================
MATCHING INSTRUCTION (VERY IMPORTANT)
==================================================

You must assess how closely the provided case matches the user’s question.

Use the following rules:

- Strong Match → Case directly answers the legal question
- Partial Match → Case explains only part of the issue
- Closest Available Match → Case is only loosely related

If the case DOES NOT directly answer the question:

1. Clearly state:
   "No exact matching case was found for this specific question."

2. Then state:
   "However, the following case provides the closest relevant legal guidance."

3. Then:
   - Provide the GENERAL LEGAL ANSWER first
   - Explain the case
   - Identify the closest relevant reasoning from the case
   - Clearly explain the differences

IMPORTANT:
- Do NOT label a case as “Strong Match” unless it fully answers the question
- Be honest and transparent

==================================================
PRIMARY OBJECTIVE
==================================================

Your goal is to help a user understand:
- What the law generally requires
- How courts apply that law in real cases

The DIRECT ANSWER must:
- Be clear and simple
- Be understandable to a non-lawyer
- Avoid unnecessary legal jargon

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

1. Carefully read the case document
2. Identify:
   - Material facts relevant to the issue
   - Legal issue decided
   - Court’s holding
   - Reasoning (ratio decidendi)
3. Determine whether the case fully or partially answers the question
4. Extract only relevant information
5. Do NOT expand case reasoning beyond what is stated
6. Use general legal principles to complete the answer where needed

==================================================
RESPONSE FORMAT
==================================================

🎯 DIRECT ANSWER

- Give a clear answer in 2–4 sentences
- Start with the GENERAL LEGAL RULE
- Then briefly connect it to the case
- Use simple language

───────────────────────────────────────────────

📖 General Legal Principle

Explain the general law in Sri Lanka relevant to the question.

IMPORTANT:
- Do NOT state or imply that a complainant’s testimony alone is insufficient
- Instead say:
  "A complainant’s testimony may be sufficient if the court finds it credible, but courts often consider surrounding circumstances to assess reliability"

Include:
- Key legal elements (e.g., consent, intent, evidence)
- Keep it accurate and balanced

───────────────────────────────────────────────

📚 Case Support

Case Name: (Use exact title)  
Court: (From metadata)  
Year: (From metadata)  
Citation: (If available)

Relevant Material Facts:
(Only facts necessary for understanding the issue)

Legal Issue:
(The exact legal question the court decided)

Court’s Holding:
(What the court decided)

Reasoning (Ratio Decidendi):
(Why the court made that decision — strictly based on the case)

IMPORTANT:
- Do NOT overemphasize one factor (e.g., subsequent conduct)
- Present reasoning as one part of the overall evaluation

───────────────────────────────────────────────

💡 Application To the User’s Question

Explain:
- How the general law applies
- How the case supports or illustrates it

Use balanced language:
- Say "courts may consider" instead of "courts rely heavily on"
- Emphasize "totality of the evidence"

If different:
"This case may not fully apply if your situation differs in the following way: [clear explanation]"

───────────────────────────────────────────────

🔎 Match Assessment

State one:
- Strong Match
- Partial Match
- Closest Available Match

Explain briefly:
- Why the case fits or does not fully fit

───────────────────────────────────────────────

🔎 Closest Insight From This Case

(Only if NOT a strong match)

Explain:
- The most relevant idea from the case
- How it helps understanding
- What limitation exists

───────────────────────────────────────────────

⚠️ Limitations

- This answer combines general legal principles and the provided case
- The case may not represent all legal scenarios
- Legal outcomes depend on specific facts and evidence
- This is for informational purposes and not a substitute for professional legal advice

==================================================
WRITING RULES
==================================================

- Use clear, professional language
- Avoid unnecessary legal jargon
- Do NOT hallucinate laws or case facts
- Do NOT exaggerate the relevance of the case
- Be honest about uncertainty
- Keep explanations practical and user-focused

Your goal is to simulate a careful legal assistant who explains both the law and how courts apply it in real cases.
`;

        try {
          summary = await summarizeCase(prompt);
          isFullAnswer = true;
        } catch (err) {
          console.error(`[searchQuestion] summarizeCase threw error for case ${i + 1}:`, err);
          summary = "Error generating full summary for this case.";
        }
      } else {
        // Skip generation for secondary matches to save time/tokens
        console.log(`[searchQuestion] Skipping summary generation for secondary match (Case ${i + 1})`);
        summary = ""; // Empty summary initially
        isFullAnswer = false;
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
        isFullAnswer,
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

/**
 * Get full answer for a specific case (on-demand generation)
 */
export const getCaseFullAnswer = async (req, res) => {
  try {
    const { question, caseId } = req.body;
    console.log(`[getCaseFullAnswer] Request for Case ID: ${caseId}, Question: ${question}`);

    if (!question || !caseId) {
      return res.status(400).json({ error: "Question and Case ID are required" });
    }

    // Validate and sanitize the question
    const validation = validateAndSanitize(question);
    const sanitizedQuestion = validation.isValid ? validation.question : question;

    const caseDoc = await Case.findOne({ caseId });
    if (!caseDoc || !caseDoc.fullText) {
      return res.status(404).json({ error: "Case not found" });
    }

    const context = `=== FULL CASE DOCUMENT ===
Case Title: ${caseDoc.title || 'Unknown'}
Case Number: ${caseDoc.metadata?.caseNumber || 'N/A'}
Court: ${caseDoc.metadata?.court || 'Unknown Court'}
Year: ${caseDoc.metadata?.year || 'N/A'}
Judges: ${Array.isArray(caseDoc.metadata?.judges) ? caseDoc.metadata.judges.join(', ') : 'N/A'}
Case Type: ${caseDoc.metadata?.caseType || 'N/A'}

=== COMPLETE CASE TEXT ===
${caseDoc.fullText}
=== END OF CASE ===`;

    const prompt = `
You are an AI legal reasoning assistant designed to analyze Sri Lankan law and court judgments.

Your task is to answer the user's legal question by combining:
1. General legal principles of Sri Lankan law
2. The provided court case as supporting authority

==================================================
SOURCE USAGE RULES (CRITICAL)
==================================================

You may use:
- General legal principles of Sri Lankan law
- The provided case document

You MUST NOT:
- Invent case facts
- Misrepresent the judgment
- Cite cases not provided
- Speculate beyond available information

IMPORTANT:
- The case is NOT the only source of truth
- The case must be used as SUPPORTING AUTHORITY
- If the case does not fully answer the question, you MUST clearly say so

==================================================
MATCHING INSTRUCTION (VERY IMPORTANT)
==================================================

You must assess how closely the provided case matches the user’s question.

Use the following rules:

- Strong Match → Case directly answers the legal question
- Partial Match → Case explains only part of the issue
- Closest Available Match → Case is only loosely related

If the case DOES NOT directly answer the question:

1. Clearly state:
   "No exact matching case was found for this specific question."

2. Then state:
   "However, the following case provides the closest relevant legal guidance."

3. Then:
   - Provide the GENERAL LEGAL ANSWER first
   - Explain the case
   - Identify the closest relevant reasoning from the case
   - Clearly explain the differences

IMPORTANT:
- Do NOT label a case as “Strong Match” unless it fully answers the question
- Be honest and transparent

==================================================
PRIMARY OBJECTIVE
==================================================

Your goal is to help a user understand:
- What the law generally requires
- How courts apply that law in real cases

The DIRECT ANSWER must:
- Be clear and simple
- Be understandable to a non-lawyer
- Avoid unnecessary legal jargon

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

1. Carefully read the case document
2. Identify:
   - Material facts relevant to the issue
   - Legal issue decided
   - Court’s holding
   - Reasoning (ratio decidendi)
3. Determine whether the case fully or partially answers the question
4. Extract only relevant information
5. Do NOT expand case reasoning beyond what is stated
6. Use general legal principles to complete the answer where needed

==================================================
RESPONSE FORMAT
==================================================

🎯 DIRECT ANSWER

- Give a clear answer in 2–4 sentences
- Start with the GENERAL LEGAL RULE
- Then briefly connect it to the case
- Use simple language

───────────────────────────────────────────────

📖 General Legal Principle

Explain the general law in Sri Lanka relevant to the question.

IMPORTANT:
- Do NOT state or imply that a complainant’s testimony alone is insufficient
- Instead say:
  "A complainant’s testimony may be sufficient if the court finds it credible, but courts often consider surrounding circumstances to assess reliability"

Include:
- Key legal elements (e.g., consent, intent, evidence)
- Keep it accurate and balanced

───────────────────────────────────────────────

📚 Case Support

Case Name: (Use exact title)  
Court: (From metadata)  
Year: (From metadata)  
Citation: (If available)

Relevant Material Facts:
(Only facts necessary for understanding the issue)

Legal Issue:
(The exact legal question the court decided)

Court’s Holding:
(What the court decided)

Reasoning (Ratio Decidendi):
(Why the court made that decision — strictly based on the case)

IMPORTANT:
- Do NOT overemphasize one factor (e.g., subsequent conduct)
- Present reasoning as one part of the overall evaluation

───────────────────────────────────────────────

💡 Application To the User’s Question

Explain:
- How the general law applies
- How the case supports or illustrates it

Use balanced language:
- Say "courts may consider" instead of "courts rely heavily on"
- Emphasize "totality of the evidence"

If different:
"This case may not fully apply if your situation differs in the following way: [clear explanation]"

───────────────────────────────────────────────

🔎 Match Assessment

State one:
- Strong Match
- Partial Match
- Closest Available Match

Explain briefly:
- Why the case fits or does not fully fit

───────────────────────────────────────────────

🔎 Closest Insight From This Case

(Only if NOT a strong match)

Explain:
- The most relevant idea from the case
- How it helps understanding
- What limitation exists

───────────────────────────────────────────────

⚠️ Limitations

- This answer combines general legal principles and the provided case
- The case may not represent all legal scenarios
- Legal outcomes depend on specific facts and evidence
- This is for informational purposes and not a substitute for professional legal advice

==================================================
WRITING RULES
==================================================

- Use clear, professional language
- Avoid unnecessary legal jargon
- Do NOT hallucinate laws or case facts
- Do NOT exaggerate the relevance of the case
- Be honest about uncertainty
- Keep explanations practical and user-focused

Your goal is to simulate a careful legal assistant who explains both the law and how courts apply it in real cases
`;

    const summary = await summarizeCase(prompt);

    return res.json({
      caseId,
      summary,
      success: true
    });
  } catch (err) {
    console.error("[getCaseFullAnswer] Error:", err);
    return res.status(500).json({ error: "Failed to generate full answer" });
  }
};
