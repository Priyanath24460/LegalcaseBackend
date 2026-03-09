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

    // Sort cases by bestScore FIRST (highest match quality), then by count (frequency) as tiebreaker
    // This ensures the case with the most relevant match appears first
    const sortedCaseIds = Object.keys(caseStats).sort((a, b) => {
      const statsA = caseStats[a];
      const statsB = caseStats[b];
      
      // Primary sort: bestScore (descending - higher is better with similarity scores)
      if (Math.abs(statsB.bestScore - statsA.bestScore) > 0.001) {
        return statsB.bestScore - statsA.bestScore;
      }
      
      // Tiebreaker 1: count (more matching sections)
      if (statsB.count !== statsA.count) {
        return statsB.count - statsA.count;
      }
      
      // Tiebreaker 2: totalScore
      return statsB.totalScore - statsA.totalScore;
    });
    
    const top3CaseIds = sortedCaseIds.slice(0, 3);
    
    console.log("[searchQuestion] Sorted cases by bestScore:", sortedCaseIds.map(caseId => ({
      caseId,
      bestScore: caseStats[caseId].bestScore.toFixed(4),
      count: caseStats[caseId].count,
      totalScore: caseStats[caseId].totalScore.toFixed(4)
    })));

    console.log(`[searchQuestion] Selected top 3 cases (by composite score): ${top3CaseIds.join(', ')}`);
    console.log("[searchQuestion] Top 5 sections used for answer:", topSections.slice(0, 5).map((s, idx) => ({
      index: idx,
      sectionId: s.sectionId,
      caseId: s.caseId,
      score: s.score?.toFixed(4)
    })));

    // Get case details with full text for all top 3 cases
    const selectedCases = [];
    try {
      for (const caseId of top3CaseIds) {
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

    // Generate summaries for all selected cases
    const caseSummaries = [];
    
    for (let i = 0; i < selectedCases.length; i++) {
      const selectedCase = selectedCases[i];
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
You are a Sri Lankan legal reasoning assistant.

ABSOLUTE RESTRICTION:
You are permitted to rely ONLY on the SINGLE case document provided below.
You must not use:
- Outside legal knowledge
- General Sri Lankan law
- Other cases
- Legal doctrines not expressly mentioned in this case
- Assumptions or speculation

If the answer is not clearly supported by this case,
you MUST explicitly say:

"The provided case does not clearly address this specific issue."

You are performing JUDGMENT-BASED reasoning — not textbook explanation.

==================================================
USER QUESTION:
"${question}"
==================================================

CASE DOCUMENT PROVIDED:
${context}

==================================================

MANDATORY ANALYTICAL STEPS:

1. Read the FULL case carefully.
2. Identify:
   - Material facts relevant to the user’s question
   - The precise legal issue decided by the court
   - The court’s holding
   - The reasoning (ratio decidendi)
3. Ignore:
   - Irrelevant background facts
   - Procedural history unless relevant
4. Do NOT:
   - Add general explanations
   - Expand principles beyond what the court actually states
   - Convert the answer into a textbook discussion

If the facts of the user's question are materially different from the case,
clearly explain the limitation.

==================================================

REQUIRED RESPONSE FORMAT

🎯 DIRECT ANSWER

✅ Short Answer  
(Answer clearly in 2–4 sentences using ONLY what this case decides. 
Do NOT use double asterisks anywhere.)

───────────────────────────────────────────────

📖 Legal Basis From This Case

Case Name: (Use exact title from metadata)
Court: (From metadata)
Year: (From metadata)
Citation: (If available)

Relevant Material Facts:  
(Describe only facts necessary to understand the issue. 
Write in plain paragraphs. No bold formatting.)

Legal Issue Decided:  
(State the precise issue the court determined.)

Court’s Holding:  
(State exactly what the court decided.)

Reasoning (Ratio Decidendi):  
(Explain the court’s reasoning strictly as derived from the judgment. 
You may use single asterisks for case names.)

───────────────────────────────────────────────

💡 Application To the User’s Question

(Explain how the court’s holding would apply IF the user’s facts are materially similar.
If factual similarity is unclear, state that explicitly.
Do not speculate beyond the judgment.)

If the case does not fully resolve the user’s scenario, clearly state:

"This case may not fully apply if your factual situation differs in the following way: [explain based only on distinctions visible from the case]."

───────────────────────────────────────────────

⚠️ Limitation

This answer is strictly and exclusively based on the single case provided above.
No other legal sources have been considered.

==================================================

CRITICAL WRITING RULES:

✓ Write in natural, professional legal prose  
✓ No double asterisks (**) anywhere  
✓ Single asterisks allowed only for case names  
✓ No dramatic tone  
✓ No extra commentary  
✓ No textbook explanation  
✓ No expansion beyond the judgment  

Remember: You are simulating judicial reasoning, not giving general legal advice.
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
