import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const callGeminiAPI = async (promptText) => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const payload = { contents: [{ parts: [{ text: promptText }] }] };
  
  if (!process.env.GEMINI_API_KEY) {
    console.error("[Gemini] GEMINI_API_KEY is not set in environment variables.");
    return "⚠️ Gemini API key is missing on the server.";
  }

  const res = await axios.post(url, payload);
  console.log("[Gemini] Full API response:", JSON.stringify(res.data, null, 2));
  
  if (
    res.data &&
    res.data.candidates &&
    res.data.candidates[0] &&
    res.data.candidates[0].content &&
    res.data.candidates[0].content.parts &&
    res.data.candidates[0].content.parts[0] &&
    typeof res.data.candidates[0].content.parts[0].text === "string"
  ) {
    return res.data.candidates[0].content.parts[0].text;
  } else {
    console.error("[Gemini] Unexpected response structure:", JSON.stringify(res.data, null, 2));
    return "⚠️ Gemini API returned an unexpected response format.";
  }
};

export const summarizeCase = async (promptText) => {
  try {
    return await callGeminiAPI(promptText);
  } catch (err) {
    if (err.response) {
      console.error("[Gemini] API error:", err.response.status, err.response.data);
      return `⚠️ Gemini API error: ${err.response.status} - ${JSON.stringify(err.response.data)}`;
    } else {
      console.error("[Gemini] Request failed:", err);
      return "⚠️ Gemini API request failed.";
    }
  }
};

export const extractMetadataWithAI = async (documentText) => {
  try {
    // Use more text for better context
    const textForAnalysis = documentText.substring(0, 6000);
    
    const prompt = `You are a legal document analysis expert. Analyze this legal document text and extract comprehensive metadata.

IMPORTANT: Return ONLY a valid JSON object with these exact fields (no additional text, explanation, or markdown):

{
  "caseName": "exact case title with parties",
  "caseNumber": "case number or file number",
  "court": "full court name",
  "judgmentDate": "judgment date as string",
  "year": year_as_number,
  "judges": ["array", "of", "judge", "names"],
  "caseType": "Civil/Criminal/Appeal/Constitutional/etc"
}

EXTRACTION RULES:

1. CASE NAME: Look for case names in formats like:
   - "ANDRIS APPTJ v. SILVA et al." 
   - "Name v. Name" or "Name v Name"
   - "Re [Name]" or "In re [Name]"
   - "In the matter of [Name]"
   - "[Company] Ltd v. [Company] Ltd"
   - Extract the complete case title, preserve original formatting

2. CASE NUMBER: Find case/file numbers like:
   - "C. R., GaUe, 3,945"
   - "Case No. 123/2023"
   - "Civil Appeal No. 45 of 2023"
   - "S 123/2023", "HC/S 456/2023"
   - Any reference numbers or file numbers

3. COURT: Find court mentions like:
   - "Singapore High Court", "Court of Appeal", "Supreme Court" 
   - "District Court", "Magistrate's Court", "Family Court"
   - Historical courts like "C. R., GaUe"
   - Include full jurisdiction and court hierarchy

4. JUDGMENT DATE: Look for dates like:
   - "21st September, 1896"
   - "September 21, 1896" 
   - "21/09/1896", "21-09-1896"
   - "Delivered on [date]", "Judgment delivered [date]"
   - Extract the complete date as written

5. YEAR: Extract year from:
   - Judgment date (preferred)
   - Case citation
   - Document header/footer
   - Must be between 1800-${new Date().getFullYear()}

6. JUDGES: Extract judge names like:
   - "BONSER, C.J."
   - "Justice Smith", "Smith J", "Smith CJ"
   - "Before: Justice A, Justice B"
   - "Coram: [judge names]"
   - Include titles (CJ, J, JA, etc.)

7. CASE TYPE: Determine from:
   - Document content and context
   - Case number patterns (Civil, Criminal, Appeal, etc.)
   - Subject matter (Constitutional, Commercial, Family, etc.)
   - Common types: Civil, Criminal, Appeal, Constitutional, Commercial, Family, Administrative

If any field cannot be found, use these defaults:
- caseName: "Unknown Case"
- caseNumber: ""
- court: "Unknown Court"
- judgmentDate: ""
- year: ${new Date().getFullYear()}
- judges: []
- caseType: "Unknown"

DOCUMENT TEXT:
${textForAnalysis}

JSON RESPONSE:`;

    console.log("[Gemini] 🤖 Sending document to Gemini AI for metadata extraction...");
    console.log("[Gemini] Document length:", textForAnalysis.length, "characters");
    
    const response = await callGeminiAPI(prompt);
    console.log("[Gemini] Raw AI response:", response);
    
    // Enhanced JSON parsing
    let metadata = null;
    
    // Try to find JSON in the response
    const jsonPatterns = [
      /\{[\s\S]*?\}/,  // Basic JSON object
      /```json\s*(\{[\s\S]*?\})\s*```/,  // JSON in code blocks
      /```\s*(\{[\s\S]*?\})\s*```/,  // JSON in any code block
    ];
    
    for (const pattern of jsonPatterns) {
      const match = response.match(pattern);
      if (match) {
        try {
          const jsonStr = match[1] || match[0];
          metadata = JSON.parse(jsonStr);
          console.log("[Gemini] ✅ Successfully parsed JSON:", metadata);
          break;
        } catch (parseError) {
          console.log("[Gemini] ❌ JSON parse failed for pattern:", pattern);
          continue;
        }
      }
    }
    
    // Validate and clean the extracted metadata
    if (metadata && typeof metadata === 'object') {
      const result = {
        caseName: (metadata.caseName && metadata.caseName !== "Unknown Case") ? 
                 String(metadata.caseName).trim().substring(0, 300) : "Unknown Case",
        caseNumber: metadata.caseNumber ? 
                   String(metadata.caseNumber).trim().substring(0, 100) : "",
        court: (metadata.court && metadata.court !== "Unknown Court") ? 
               String(metadata.court).trim().substring(0, 150) : "Unknown Court",
        judgmentDate: metadata.judgmentDate ? 
                     String(metadata.judgmentDate).trim().substring(0, 50) : "",
        year: metadata.year && !isNaN(metadata.year) && metadata.year >= 1800 && metadata.year <= new Date().getFullYear() ? 
              parseInt(metadata.year) : new Date().getFullYear(),

        judges: Array.isArray(metadata.judges) ? 
               metadata.judges.map(judge => String(judge).trim()).filter(judge => judge.length > 0) : [],
        caseType: metadata.caseType ? 
                 String(metadata.caseType).trim().substring(0, 50) : "Unknown",
        
        // Backward compatibility fields
        title: (metadata.caseName && metadata.caseName !== "Unknown Case") ? 
               String(metadata.caseName).trim().substring(0, 200) : "Unknown Title"
      };
      
      console.log("[Gemini] 🎯 Final cleaned metadata:", result);
      
      // Check if we got meaningful data
      if (result.caseName !== "Unknown Case" || result.court !== "Unknown Court" || 
          result.caseNumber || result.judges.length > 0) {
        return result;
      }
    }
    
    console.log("[Gemini] ⚠️ No valid metadata extracted from AI response");
    return null;
    
  } catch (err) {
    console.error("[Gemini] ❌ Metadata extraction failed:", err.message);
    return null;
  }
};

// Simple in-memory cache for rewritten questions
const rewriteCache = new Map();
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

// Rate limiting: Track last request time
let lastRewriteRequestTime = 0;
const MIN_REQUEST_INTERVAL = 2000; // 2 seconds between requests

/**
 * Rewrite user question to be more clear and meaningful while preserving intent
 * @param {string} originalQuestion - The user's original question
 * @returns {Promise<string>} - The rewritten, improved question
 */
export const rewriteQuestion = async (originalQuestion) => {
  try {
    // Check cache first
    const cacheKey = originalQuestion.toLowerCase().trim();
    const cached = rewriteCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      console.log("[Gemini] Using cached rewrite for question");
      return cached.rewritten;
    }

    // Rate limiting: Wait if needed
    const now = Date.now();
    const timeSinceLastRequest = now - lastRewriteRequestTime;
    
    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
      const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
      console.log(`[Gemini] Rate limiting: waiting ${waitTime}ms before next request`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    lastRewriteRequestTime = Date.now();

const prompt = `You are a legal language expert tasked with helping users rewrite legal questions for improved clarity and relevance to Sri Lankan case law.

TASK: Rewrite the following question to make it clearer, grammatically correct, and better suited for searching Sri Lankan legal cases, while keeping the original intent intact. Normalize non-Sri Lankan or generic legal terms into the corresponding Sri Lankan legal terminology using the mapping table below.

LEGAL TERM MAPPING TABLE (for reference):
- "eminent domain" → "land acquisition"
- "condemnation" → "compulsory acquisition"
- "injunction" → "interlocutory order"
- "taking of property" → "acquisition of land by the State"
- "government seizure" → "State acquisition"
- "public use" → "public purpose"
- "divestment" → "return of land"
- "compensation" → "payment for land under acquisition"
- "expropriation" → "acquisition under Land Acquisition Act"
- "authority" → "Minister or relevant acquiring officer"

GUIDELINES:
1. Correct any spelling or grammar errors.
2. Make the question precise and specific.
3. Replace foreign or generic legal terms with the appropriate Sri Lankan legal terminology from the mapping table where applicable.
4. Preserve the original meaning and intent exactly.
5. Keep it concise and similar in length to the original.
6. Maintain the original question format (if it is a question, keep it as a question).
7. Do NOT introduce new information or context not present in the original question.
8. Do NOT alter the fundamental legal issue being asked.

ORIGINAL QUESTION:
"${originalQuestion}"

REWRITTEN QUESTION (respond with ONLY the improved question, no explanations or additional text):`;
    const rewrittenText = await callGeminiAPI(prompt);
    
    // Clean up the response (remove quotes, extra whitespace, etc.)
    let cleaned = rewrittenText.trim();
    
    // Remove surrounding quotes if present
    if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || 
        (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
      cleaned = cleaned.slice(1, -1);
    }
    
    // Remove "Rewritten Question:" or similar prefixes
    cleaned = cleaned.replace(/^(Rewritten Question:|Improved Question:|Question:)\s*/i, '');
    
    cleaned = cleaned.trim();
    
    // Cache the result
    rewriteCache.set(cacheKey, {
      rewritten: cleaned,
      timestamp: Date.now()
    });

    // Clean old cache entries (keep last 100)
    if (rewriteCache.size > 100) {
      const firstKey = rewriteCache.keys().next().value;
      rewriteCache.delete(firstKey);
    }
    
    console.log("[Gemini] Question rewrite successful");
    console.log("[Gemini] Original:", originalQuestion);
    console.log("[Gemini] Rewritten:", cleaned);
    
    return cleaned;
    
  } catch (err) {
    console.error("[Gemini] ❌ Question rewrite failed:", err.message);
    
    // Check if it's a rate limit error
    if (err.response && err.response.status === 429) {
      throw new Error("RATE_LIMIT");
    }
    
    throw new Error("Failed to rewrite question");
  }
};

/**
 * Use AI to rank 3 cases based on actual relevance to user's question
 * This replaces FAISS score-based ranking with semantic relevance understanding
 * 
 * @param {string} question - User's original question
 * @param {Array} topCases - Array of case objects from MongoDB with {caseId, title, metadata, fullText}
 * @returns {Promise<Array>} - Returns reordered case IDs [caseId1, caseId2, caseId3]
 */
export const rankCasesRelevance = async (question, topCases) => {
  try {
    if (!topCases || topCases.length === 0) {
      console.log("[Gemini Ranker] No cases to rank");
      return [];
    }

    console.log(`[Gemini Ranker] Ranking ${topCases.length} cases for question: "${question}"`);

    // Extract key information from each case for AI analysis
    const caseSummaries = topCases.map((caseItem, idx) => {
      const textPreview = caseItem.fullText 
        ? caseItem.fullText.substring(0, 800) + "..."
        : "No full text available";
      
      return {
        displayNumber: idx + 1,
        caseId: caseItem.caseId,
        title: caseItem.title || "Unknown Title",
        court: caseItem.metadata?.court || "Unknown Court",
        year: caseItem.metadata?.year || "Unknown Year",
        caseNumber: caseItem.metadata?.caseNumber || "N/A",
        caseType: caseItem.metadata?.caseType || "Unknown",
        textPreview: textPreview
      };
    });

    // Build the ranking prompt
    const rankingPrompt = `You are a legal expert evaluator. Your task is to assess which of the 3 cases below BEST answers the user's legal question.

USER'S QUESTION:
"${question}"

===== CASES TO EVALUATE =====

${caseSummaries.map((c, idx) => `
CASE ${idx + 1}:
- Title: ${c.title}
- Court: ${c.court}
- Year: ${c.year}
- Case Number: ${c.caseNumber}
- Case Type: ${c.caseType}
- Text Preview: ${c.textPreview}
- Case ID: ${c.caseId}
`).join('\n')}

===== EVALUATION CRITERIA =====

For each case, consider:
1. DIRECT RELEVANCE: Does this case directly address the legal issue in the question?
2. APPLICABLE LAW: Does this case apply the law that would apply to the user's situation?
3. FACTUAL SIMILARITY: Are the facts similar enough that the court's reasoning would apply?
4. CLARITY: Does this case provide clear guidance for answering the user's question?

===== YOUR TASK =====

Rank the 3 cases from MOST relevant to LEAST relevant by rating each on a scale of 0-100%.

RESPOND in this EXACT format (no other text, NO explanations):

CASE_1_ID: [CaseID]
CASE_1_SCORE: [0-100]%
CASE_1_REASON: [1 sentence why this is the best/worst match]

CASE_2_ID: [CaseID]
CASE_2_SCORE: [0-100]%
CASE_2_REASON: [1 sentence]

CASE_3_ID: [CaseID]
CASE_3_SCORE: [0-100]%
CASE_3_REASON: [1 sentence]

Then rank them by score (highest first):
RANKED_ORDER: [CaseID1, CaseID2, CaseID3]`;

    console.log(`[Gemini Ranker] Sending ${topCases.length} cases to Gemini for ranking...`);
    const aiResponse = await callGeminiAPI(rankingPrompt);
    console.log(`[Gemini Ranker] AI Response:\n${aiResponse}`);

    // Parse the AI response to extract rankings
    const rankedOrder = parseRankingResponse(aiResponse, topCases);
    
    if (rankedOrder && rankedOrder.length > 0) {
      console.log(`[Gemini Ranker] ✅ Successfully ranked cases: ${rankedOrder.join(', ')}`);
      return rankedOrder;
    } else {
      console.log(`[Gemini Ranker] ⚠️ Failed to parse AI ranking, using original order`);
      return topCases.map(c => c.caseId);
    }

  } catch (err) {
    console.error(`[Gemini Ranker] ❌ Error ranking cases:`, err.message);
    // Return original order if ranking fails
    return topCases.map(c => c.caseId);
  }
};

/**
 * Parse AI ranking response to extract case IDs in ranked order
 * @param {string} response - The AI response text
 * @param {Array} topCases - Original case objects for fallback
 * @returns {Array} - Case IDs in ranked order
 */
const parseRankingResponse = (response, topCases) => {
  try {
    // Look for RANKED_ORDER line
    const rankedOrderMatch = response.match(/RANKED_ORDER:\s*\[([^\]]+)\]/i);
    
    if (rankedOrderMatch) {
      const caseIdsStr = rankedOrderMatch[1];
      // Split by comma and clean whitespace
      const caseIds = caseIdsStr.split(',').map(id => id.trim());
      
      console.log(`[Gemini Ranker] Extracted ranked order: ${caseIds.join(', ')}`);
      
      // Validate that all extracted IDs are from the original cases
      const validIds = caseIds.filter(id => 
        topCases.some(c => c.caseId === id)
      );
      
      if (validIds.length === topCases.length) {
        return validIds;
      }
    }
    
    // Alternative parsing: look for individual CASE_X_ID lines
    const caseLines = response.match(/CASE_[123]_ID:\s*([^\n]+)/gi);
    if (caseLines && caseLines.length >= 3) {
      const extractedIds = caseLines.map(line => {
        const match = line.match(/CASE_[123]_ID:\s*(.+)/i);
        return match ? match[1].trim() : null;
      }).filter(id => id !== null);
      
      console.log(`[Gemini Ranker] Extracted IDs from individual lines: ${extractedIds.join(', ')}`);
      
      // Sort by score
      const scoreLines = response.match(/CASE_[123]_SCORE:\s*([0-9]+)%/gi);
      if (scoreLines && scoreLines.length === extractedIds.length) {
        const scores = scoreLines.map(line => {
          const match = line.match(/([0-9]+)%/);
          return match ? parseInt(match[1]) : 0;
        });
        
        // Pair IDs with scores and sort
        const paired = extractedIds.map((id, idx) => ({ id, score: scores[idx] }))
          .sort((a, b) => b.score - a.score);
        
        const sortedIds = paired.map(p => p.id);
        console.log(`[Gemini Ranker] Sorted by score: ${sortedIds.join(', ')}`);
        return sortedIds;
      }
    }
    
    console.log(`[Gemini Ranker] Could not parse ranking response`);
    return null;
    
  } catch (err) {
    console.error(`[Gemini Ranker] Error parsing response:`, err.message);
    return null;
  }
};
