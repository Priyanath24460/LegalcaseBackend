#!/usr/bin/env python3
import sys
import json
import time
from sentence_transformers import SentenceTransformer
import torch

BATCH_SIZE = 32  # Tune this for your hardware

def main():
    start_time = time.time()
    print("[embed_text.py] Script started", file=sys.stderr)
    input_data = sys.stdin.read()
    print("[embed_text.py] Input data received", file=sys.stderr)
    data = json.loads(input_data)
    texts = data["texts"]
    print(f"[embed_text.py] Number of texts: {len(texts)}", file=sys.stderr)
    model_name = data.get("model_name", "all-MiniLM-L6-v2")
    print(f"[embed_text.py] Loading model: {model_name}", file=sys.stderr)
    model_load_start = time.time()
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[embed_text.py] Using device: {device}", file=sys.stderr)
    model = SentenceTransformer(model_name, device=device)
    model_load_end = time.time()
    print(f"[embed_text.py] Model loaded in {model_load_end - model_load_start:.2f} seconds", file=sys.stderr)

    encode_start = time.time()
    embeddings = []
    total = len(texts)
    for i in range(0, total, BATCH_SIZE):
        batch = texts[i:i+BATCH_SIZE]
        batch_embeddings = model.encode(batch, show_progress_bar=False, device=device)
        embeddings.extend(batch_embeddings)
        print(f"[embed_text.py] Processed batch {i//BATCH_SIZE+1}/{(total-1)//BATCH_SIZE+1}", file=sys.stderr)
    encode_end = time.time()
    print(f"[embed_text.py] Embedding generation took {encode_end - encode_start:.2f} seconds", file=sys.stderr)
    print(json.dumps({"embeddings": [e.tolist() for e in embeddings]}))
    end_time = time.time()
    print(f"✅ Successfully parsed embedding, length: {len(embeddings[0]) if embeddings else 0}", file=sys.stderr)
    print(f"⏰ Total script time: {end_time - start_time:.2f} seconds", file=sys.stderr)

if __name__ == "__main__":
    main()
