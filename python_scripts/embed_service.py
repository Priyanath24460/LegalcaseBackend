from fastapi import FastAPI, Request
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
import torch
import uvicorn
import time

app = FastAPI()

class EmbedRequest(BaseModel):
    texts: list[str]
    model_name: str = "all-MiniLM-L6-v2"  # General model for better semantic matching

# Load model once at startup
device = "cuda" if torch.cuda.is_available() else "cpu"
model = None

@app.on_event("startup")
def load_model():
    global model
    print(f"[embed_service] Loading model on {device}...")
    model = SentenceTransformer("all-MiniLM-L6-v2", device=device)
    print("[embed_service] Model loaded.")

@app.post("/embed")
async def embed(req: EmbedRequest):
    start = time.time()
    print(f"[embed_service] Embedding texts: {[text[:50] + '...' for text in req.texts]}")
    embeddings = model.encode(req.texts, show_progress_bar=False, device=device)
    
    # Normalize embeddings for cosine similarity
    import numpy as np
    embeddings = np.array(embeddings)
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    embeddings = embeddings / norms
    embeddings = embeddings.tolist()
    
    duration = time.time() - start
    print(f"[embed_service] Embedded {len(req.texts)} texts in {duration:.2f}s")
    return {"embeddings": embeddings}

@app.get("/health")
async def health_check():
    """Health check endpoint for Render"""
    return {"status": "healthy", "model_loaded": model is not None}

if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("embed_service:app", host="0.0.0.0", port=port, reload=True)
