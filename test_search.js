import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

async function testSearch() {
  try {
    console.log('Testing search query...\n');
    
    const query = "muslim marriage divorce";
    const response = await axios.post('http://localhost:5000/api/query', {
      question: query
    });
    
    console.log('=== SEARCH RESULTS ===');
    console.log(`Query: "${query}"`);
    console.log(`\nTop Sections (${response.data.topSections?.length || 0}):`);
    response.data.topSections?.forEach((s, i) => {  // Show ALL sections, not just first 3
      console.log(`${i+1}. Section: ${s.sectionId}`);
      console.log(`   Case: ${s.caseId}`);
      console.log(`   Score: ${s.score}`);
      console.log(`   Text: ${s.text?.substring(0, 80)}...`);
      console.log('');
    });
    
    console.log(`\n=== TOP CASES ===`);
    console.log(`Count: ${response.data.topCases?.length || 0}`);
    console.log(`Cases: ${JSON.stringify(response.data.topCases)}`);
    
    console.log(`\n=== SELECTED CASE ===`);
    console.log(`Case ID: ${response.data.selectedCase?.caseId}`);
    console.log(`Title: ${response.data.selectedCase?.title}`);
    
    console.log(`\nSummary: ${response.data.summary?.substring(0, 200)}...`);
    
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

testSearch();
