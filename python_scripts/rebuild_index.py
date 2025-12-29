import os
import sys
import json
import numpy as np
from pymongo import MongoClient
from sentence_transformers import SentenceTransformer
import torch
from faiss_operations import FAISSManager
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

# Load environment variables
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("DB_NAME", "legal_case_finder")

# Connect to MongoDB
client = MongoClient(MONGO_URI)
db = client[DB_NAME]

# Load embedding model
device = "cuda" if torch.cuda.is_available() else "cpu"
model = SentenceTransformer("all-MiniLM-L6-v2", device=device)
print(f"[Rebuild] Loaded model on {device}")

# Fetch all sections
sections = list(db.sections.find({}))
print(f"[Rebuild] Found {len(sections)} sections in database")

if len(sections) == 0:
    print("[Rebuild] No sections found in MongoDB. Nothing to rebuild.")
    client.close()
    sys.exit(0)

# Generate new embeddings
embeddings_data = []
print(f"[Rebuild] Starting to process {len(sections)} sections...")
for idx, section in enumerate(sections, 1):
    text = section['text']
    # Clean the text the same way as the embedding service
    clean_text = text.replace('\r', ' ').replace('\n', ' ').replace('\t', ' ')
    clean_text = ''.join(c for c in clean_text if ord(c) >= 32 and ord(c) <= 126)  # Keep only printable ASCII
    clean_text = ' '.join(clean_text.split())  # Normalize spaces
    clean_text = clean_text.strip()
    
    if not clean_text:
        print(f"[Rebuild] Skipping empty section {section['sectionId']}")
        continue
    
    embedding = model.encode(clean_text, show_progress_bar=False, device=device)
    # Normalize the embedding for cosine similarity
    import numpy as np
    embedding = embedding / np.linalg.norm(embedding)
    embedding = embedding.tolist()
    embeddings_data.append({
        'sectionId': section['sectionId'],
        'caseId': section['caseId'],
        'text': clean_text,  # Store cleaned text
        'embedding': embedding
    })
    if idx % 10 == 0 or idx == len(sections):
        print(f"[Rebuild] Processed {idx}/{len(sections)} sections ({(idx/len(sections)*100):.1f}%)")

print(f"[Rebuild] ====================================")
print(f"[Rebuild] Starting FAISS index rebuild...")
print(f"[Rebuild] Total embeddings to index: {len(embeddings_data)}")
print(f"[Rebuild] ====================================")

faiss_manager = FAISSManager()
result = faiss_manager.rebuild_index(embeddings_data)

print(f"[Rebuild] ====================================")
if result['success']:
    print(f"[Rebuild] ✅ Successfully rebuilt index with {result['count']} items")
    print(f"[Rebuild] MongoDB sections: {len(sections)}")
    print(f"[Rebuild] FAISS index items: {result['count']}")
    if result['count'] == len(sections):
        print(f"[Rebuild] ✅ Counts match! Index is synchronized.")
    else:
        print(f"[Rebuild] ⚠️ Count mismatch! Some sections may not have been indexed.")
else:
    print(f"[Rebuild] ❌ Failed to rebuild index: {result['error']}")
    sys.exit(1)
print(f"[Rebuild] ====================================")

# Close MongoDB connection
client.close()