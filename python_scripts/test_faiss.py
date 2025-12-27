import os
import faiss
import pickle
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

print("Testing FAISS service...")

# Load FAISS index and metadata
index = None
metadata = []

try:
    # Look for files in parent directory (backend/)
    current_dir = os.path.dirname(os.path.abspath(__file__))
    parent_dir = os.path.dirname(current_dir)
    index_path = os.path.join(parent_dir, "legal_index.faiss")
    metadata_path = os.path.join(parent_dir, "legal_metadata.pkl")

    print(f"Looking for index at: {index_path}")
    print(f"Looking for metadata at: {metadata_path}")

    if os.path.exists(index_path) and os.path.exists(metadata_path):
        print("Files exist, loading...")
        index = faiss.read_index(index_path)
        with open(metadata_path, 'rb') as f:
            metadata = pickle.load(f)
        print(f"Successfully loaded index with {len(metadata)} items")
    else:
        print(f"Files not found: index={os.path.exists(index_path)}, metadata={os.path.exists(metadata_path)}")

    # Test search
    class SearchRequest(BaseModel):
        embedding: list[float]
        top_k: int = 10

    # Create test request
    test_embedding = [0.1] * 768
    req = SearchRequest(embedding=test_embedding, top_k=5)

    print(f"Testing search with embedding length: {len(req.embedding)}")

    if index is None or not metadata:
        print("Index or metadata not loaded")
    else:
        query_vector = np.array([req.embedding], dtype=np.float32)
        print(f"Query vector shape: {query_vector.shape}")

        scores, indices = index.search(query_vector, min(req.top_k, len(metadata)))
        print(f"Search completed. Scores shape: {scores.shape}, Indices shape: {indices.shape}")

        results = []
        top_cases = set()

        for i, (score, idx) in enumerate(zip(scores[0], indices[0])):
            if idx < len(metadata):
                section_data = metadata[idx].copy()
                section_data['score'] = float(score)
                section_data['rank'] = i + 1
                section_data['caseId'] = section_data['case_id']  # Convert to camelCase for frontend
                section_data['sectionId'] = section_data['section_id']  # Convert to camelCase for frontend
                results.append(section_data)
                top_cases.add(section_data['case_id'])

        print(f"Returning {len(results)} results")
        print("Test completed successfully!")

except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()