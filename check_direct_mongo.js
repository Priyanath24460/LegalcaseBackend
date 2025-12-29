import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.DB_NAME || 'legal_db';

async function checkDirectMongo() {
  const client = new MongoClient(MONGO_URI);
  
  try {
    await client.connect();
    console.log('Connected to MongoDB Atlas\n');
    
    const db = client.db(DB_NAME);
    
    // Count sections
    const sectionCount = await db.collection('sections').countDocuments();
    console.log(`Sections count: ${sectionCount}`);
    
    // Get one section
    const section = await db.collection('sections').findOne({});
    console.log('\n=== SAMPLE SECTION ===');
    console.log(JSON.stringify(section, null, 2));
    
    // Get one case
    const caseDoc = await db.collection('cases').findOne({});
    console.log('\n=== SAMPLE CASE ===');
    console.log(JSON.stringify(caseDoc, null, 2));
    
  } finally {
    await client.close();
  }
}

checkDirectMongo();
