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
