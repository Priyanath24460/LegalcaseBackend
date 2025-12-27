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

# Generate new embeddings
embeddings_data = []
for section in sections:
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
    print(f"[Rebuild] Processed section {section['sectionId']}")

# Rebuild FAISS index
faiss_manager = FAISSManager()
result = faiss_manager.rebuild_index(embeddings_data)

if result['success']:
    print(f"[Rebuild] Successfully rebuilt index with {result['count']} items")
else:
    print(f"[Rebuild] Failed to rebuild index: {result['error']}")
    sys.exit(1)

# Close MongoDB connection
client.close()