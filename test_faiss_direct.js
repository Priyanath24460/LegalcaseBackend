import axios from 'axios';
import { generateEmbedding } from './services/embeddingService.js';
import dotenv from 'dotenv';

dotenv.config();

async function testFAISSDirect() {
  try {
    console.log('Testing FAISS service directly...\n');
    
    const query = "muslim marriage divorce";
    const queryEmbedding = await generateEmbedding(query);
    
    const response = await axios.post('http://localhost:8001/search', {
      embedding: queryEmbedding,
      top_k: 10
    });
    
    console.log('=== FAISS RESPONSE ===');
    console.log(`Success: ${response.data.success}`);
    console.log(`\nTop Sections (${response.data.topSections?.length || 0}):`);
    response.data.topSections?.slice(0, 5).forEach((s, i) => {
      console.log(`${i+1}. Section: ${s.sectionId || s.section_id}`);
      console.log(`   Case: ${s.caseId || s.case_id}`);
      console.log(`   Score: ${s.score}`);
      console.log('');
    });
    
    console.log(`\nTop Cases from FAISS: ${JSON.stringify(response.data.topCases)}`);
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testFAISSDirect();
