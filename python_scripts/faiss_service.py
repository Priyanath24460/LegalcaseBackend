from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import numpy as np
import faiss
import pickle
import os
from typing import List

print("[FAISS Service] Starting FAISS service...")

app = FastAPI()

class SearchRequest(BaseModel):
    embedding: List[float]
    top_k: int = 20  # Increased default from 10 to 20
    
    class Config:
        arbitrary_types_allowed = True
    
    class Config:
        arbitrary_types_allowed = True

# Load FAISS index and metadata at startup
index = None
metadata = []

def load_faiss():
    print("[FAISS Service] Loading FAISS index manually...")
    global index, metadata
    try:
        # Look for files in parent directory (backend/)
        current_dir = os.path.dirname(os.path.abspath(__file__))
        parent_dir = os.path.dirname(current_dir)
        index_path = os.path.join(parent_dir, "legal_index.faiss")
        metadata_path = os.path.join(parent_dir, "legal_metadata.pkl")
        
        print(f"[FAISS Service] Looking for index at: {index_path}")
        print(f"[FAISS Service] Looking for metadata at: {metadata_path}")
        print(f"[FAISS Service] Index file exists: {os.path.exists(index_path)}")
        print(f"[FAISS Service] Metadata file exists: {os.path.exists(metadata_path)}")
        
        if os.path.exists(index_path) and os.path.exists(metadata_path):
            print("[FAISS Service] Loading FAISS index...")
            index = faiss.read_index(index_path)
            print(f"[FAISS Service] Index loaded, dimension: {index.d}")
            
            print("[FAISS Service] Loading metadata...")
            with open(metadata_path, 'rb') as f:
                metadata = pickle.load(f)
            print(f"[FAISS Service] Loaded index with {len(metadata)} items")
        else:
            print(f"[FAISS Service] No FAISS index found - will need to be built first")
            print(f"[FAISS Service] Checked paths: {index_path}, {metadata_path}")
    except Exception as e:
        print(f"[FAISS Service] Error loading index: {e}")
        import traceback
        traceback.print_exc()

# Load the index immediately
load_faiss()

@app.on_event("startup")
def startup_event():
    print("[FAISS Service] FastAPI startup event")
    # Index should already be loaded above

@app.post("/search")
async def search_faiss(req: SearchRequest):
    print(f"[FAISS] Received request: embedding length={len(req.embedding) if req.embedding else 0}, top_k={req.top_k}")
    
    try:
        if index is None or not metadata:
            print(f"[FAISS] ERROR: Index or metadata not loaded. Index: {index}, Metadata: {len(metadata) if metadata else 0}")
            raise HTTPException(status_code=500, detail="FAISS index not loaded")

        print(f"[FAISS] Creating query vector...")
        query_vector = np.array([req.embedding], dtype=np.float32)
        print(f"[FAISS] Query vector created with shape: {query_vector.shape}")

        print(f"[FAISS] Performing search...")
        scores, indices = index.search(query_vector, min(req.top_k, len(metadata)))
        print(f"[FAISS] Search completed successfully")
        print(f"[FAISS] Top scores: {scores[0][:5]}")  # Log top 5 scores

        results = []
        top_cases = set()

        print(f"[FAISS] === MOST RELEVANT RESULTS ===")
        for i, (score, idx) in enumerate(zip(scores[0], indices[0])):
            if idx < len(metadata):
                section_data = metadata[idx].copy()
                section_data['score'] = float(score)
                section_data['rank'] = i + 1
                section_data['caseId'] = section_data['case_id']
                section_data['sectionId'] = section_data['section_id']
                results.append(section_data)
                top_cases.add(section_data['case_id'])
                
                # Log all top results with clear formatting
                print(f"[FAISS] RANK {i+1}: Section ID = {section_data['section_id']}, Case ID = {section_data['case_id']}, Score = {score:.4f}")
                print(f"[FAISS]         Text Preview: '{section_data['text'][:150].replace(chr(10), ' ').replace(chr(13), ' ')}...'")
                print(f"[FAISS]         ---")

        print(f"[FAISS] === SUMMARY ===")
        print(f"[FAISS] Total results: {len(results)}")
        print(f"[FAISS] Unique cases found: {list(top_cases)}")
        print(f"[FAISS] =====================")
        return {
            'success': True,
            'topSections': results,
            'topCases': list(top_cases),
            'count': len(results)
        }
    except Exception as e:
        print(f"[FAISS] Exception: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    import os
    port = int(os.environ.get("PORT", 8001))
    uvicorn.run("faiss_service:app", host="0.0.0.0", port=port, reload=True)
