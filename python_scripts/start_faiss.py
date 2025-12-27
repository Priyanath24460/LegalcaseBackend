#!/usr/bin/env python3
"""
Startup script for Render deployment
Reads PORT from environment and starts uvicorn
"""
import os
import uvicorn

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8001))
    print(f"Starting faiss_service on port {port}")
    uvicorn.run(
        "faiss_service:app",
        host="0.0.0.0",
        port=port,
        log_level="info"
    )
