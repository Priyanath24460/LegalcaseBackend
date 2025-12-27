import sys
import json
import numpy as np
import faiss
import pickle
import os
from pathlib import Path

class FAISSManager:
    def __init__(self, index_path="legal_index.faiss", metadata_path="legal_metadata.pkl"):
        self.index_path = index_path
        self.metadata_path = metadata_path
        self.index = None
        self.metadata = []
        
    def add_incremental(self, embeddings_data):
        """Add new embeddings to existing FAISS index"""
        try:
            # Load existing index and metadata if available
            if os.path.exists(self.index_path) and os.path.exists(self.metadata_path):
                self.index = faiss.read_index(self.index_path)
                with open(self.metadata_path, 'rb') as f:
                    existing_metadata = pickle.load(f)
                existing_ids = {m["section_id"] for m in existing_metadata}
                print(f"Loaded existing index with {len(existing_metadata)} items", file=sys.stderr)
            else:
                # Create new index
                existing_metadata = []
                existing_ids = set()
                dim = len(embeddings_data[0]['embedding']) if embeddings_data else 768
                self.index = faiss.IndexFlatIP(dim)
                print(f"Created new index with dimension {dim}", file=sys.stderr)

            # Filter out already indexed sections
            new_embeddings_data = [item for item in embeddings_data if item['sectionId'] not in existing_ids]

            if not new_embeddings_data:
                return {
                    'success': True,
                    'message': 'No new sections to add',
                    'count': len(existing_metadata)
                }

            # Prepare new embeddings and metadata
            new_embeddings = []
            new_metadata = []

            for item in new_embeddings_data:
                new_embeddings.append(np.array(item['embedding'], dtype=np.float32))
                new_metadata.append({
                    'section_id': item['sectionId'],
                    'case_id': item['caseId'],
                    'text': item['text']
                })

            # Add to index
            new_embeddings_matrix = np.vstack(new_embeddings)
            self.index.add(new_embeddings_matrix)

            # Update metadata
            existing_metadata.extend(new_metadata)

            # Save updated index and metadata
            faiss.write_index(self.index, self.index_path)
            with open(self.metadata_path, 'wb') as f:
                pickle.dump(existing_metadata, f)

            return {
                'success': True,
                'message': f'Added {len(new_embeddings)} new sections to index',
                'count': len(existing_metadata)
            }

        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    def load_index(self):
        """Load existing FAISS index and metadata"""
        try:
            if os.path.exists(self.index_path) and os.path.exists(self.metadata_path):
                self.index = faiss.read_index(self.index_path)
                with open(self.metadata_path, 'rb') as f:
                    self.metadata = pickle.load(f)
                return {
                    'success': True, 
                    'message': f'Index loaded with {len(self.metadata)} items',
                    'count': len(self.metadata)
                }
            else:
                return {'success': False, 'error': 'Index files not found'}
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    def search(self, query_embedding, top_k=10):
        """Search for similar vectors in the index"""
        try:
            print(f"[FAISS] Starting search with top_k={top_k}", file=sys.stderr)
            if self.index is None:
                print("[FAISS] Index is None, loading...", file=sys.stderr)
                load_result = self.load_index()
                if not load_result['success']:
                    print(f"[FAISS] Load failed: {load_result}", file=sys.stderr)
                    return load_result
            
            print(f"[FAISS] Index loaded, ntotal={self.index.ntotal}", file=sys.stderr)
            # Convert query embedding to numpy array
            query_vector = np.array([query_embedding], dtype=np.float32)
            print(f"[FAISS] Query vector shape: {query_vector.shape}", file=sys.stderr)
            
            # Search
            print("[FAISS] Performing search...", file=sys.stderr)
            scores, indices = self.index.search(query_vector, min(top_k, len(self.metadata)))
            print(f"[FAISS] Search completed. Scores shape: {scores.shape}, Indices shape: {indices.shape}", file=sys.stderr)
            
            # Get results
            results = []
            top_cases = set()
            
            for i, (score, idx) in enumerate(zip(scores[0], indices[0])):
                if idx < len(self.metadata):  # Valid index
                    section_data = self.metadata[idx].copy()
                    section_data['score'] = float(score)
                    section_data['rank'] = i + 1
                    results.append(section_data)
                    top_cases.add(section_data['caseId'])
            
            print(f"[FAISS] Found {len(results)} results", file=sys.stderr)
            return {
                'success': True,
                'topSections': results,
                'topCases': list(top_cases),
                'count': len(results)
            }
            
        except Exception as e:
            print(f"[FAISS] Exception in search: {str(e)}", file=sys.stderr)
            import traceback
            traceback.print_exc(file=sys.stderr)
            return {'success': False, 'error': str(e)}

    def rebuild_index(self, embeddings_data):
        """Rebuild the FAISS index from scratch"""
        try:
            # Clear existing index and metadata files
            if os.path.exists(self.index_path):
                os.remove(self.index_path)
            if os.path.exists(self.metadata_path):
                os.remove(self.metadata_path)

            # Create a new index
            dim = len(embeddings_data[0]['embedding']) if embeddings_data else 768
            self.index = faiss.IndexFlatIP(dim)
            print(f"[FAISS] Created new index with dimension {dim}", file=sys.stderr)

            # Prepare embeddings and metadata
            new_embeddings = []
            new_metadata = []

            for item in embeddings_data:
                new_embeddings.append(np.array(item['embedding'], dtype=np.float32))
                new_metadata.append({
                    'section_id': item['sectionId'],
                    'case_id': item['caseId'],
                    'text': item['text']
                })

            # Add embeddings to the index
            if new_embeddings:
                new_embeddings_matrix = np.vstack(new_embeddings)
                self.index.add(new_embeddings_matrix)

            # Save the new index and metadata
            faiss.write_index(self.index, self.index_path)
            with open(self.metadata_path, 'wb') as f:
                pickle.dump(new_metadata, f)

            print(f"[FAISS] Rebuilt index with {len(new_metadata)} items", file=sys.stderr)
            return {
                'success': True,
                'message': f'Rebuilt index with {len(new_metadata)} items',
                'count': len(new_metadata)
            }

        except Exception as e:
            print(f"[FAISS] Error rebuilding index: {str(e)}", file=sys.stderr)
            return {'success': False, 'error': str(e)}

def main():
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'No operation specified'}))
        return
    
    operation = sys.argv[1]
    faiss_manager = FAISSManager()
    
    if operation == 'build':
        if len(sys.argv) < 3:
            print(json.dumps({'success': False, 'error': 'No embeddings data provided'}))
            return
        
        try:
            data_arg = sys.argv[2]
            print(f"Build operation received data_arg: {data_arg}", file=sys.stderr)
            
            # Check if it's a file path
            if os.path.isfile(data_arg):
                print(f"Reading from file: {data_arg}", file=sys.stderr)
                with open(data_arg, 'r') as f:
                    embeddings_data = json.load(f)
                print(f"Loaded {len(embeddings_data)} embeddings from file", file=sys.stderr)
            else:
                print(f"Parsing as JSON string", file=sys.stderr)
                embeddings_data = json.loads(data_arg)
                
            result = faiss_manager.build_index(embeddings_data)
            print(json.dumps(result))
        except json.JSONDecodeError as e:
            print(json.dumps({'success': False, 'error': f'Invalid JSON: {str(e)}'}))
        except Exception as e:
            print(json.dumps({'success': False, 'error': f'Error reading data: {str(e)}'}))
    
    elif operation == 'load':
        result = faiss_manager.load_index()
        print(json.dumps(result))
    
    elif operation == 'search':
        if len(sys.argv) < 3:
            print(json.dumps({'success': False, 'error': 'No query embedding provided'}))
            return
        
        try:
            data_arg = sys.argv[2]
            
            # Check if it's a file path
            if os.path.isfile(data_arg):
                with open(data_arg, 'r') as f:
                    query_data = json.load(f)
            else:
                query_data = json.loads(data_arg)
                
            query_embedding = query_data['embedding']
            top_k = query_data.get('top_k', 10)
            
            result = faiss_manager.search(query_embedding, top_k)
            print(json.dumps(result))
        except json.JSONDecodeError as e:
            print(json.dumps({'success': False, 'error': f'Invalid JSON: {str(e)}'}))
        except KeyError as e:
            print(json.dumps({'success': False, 'error': f'Missing key: {str(e)}'}))
        except Exception as e:
            print(json.dumps({'success': False, 'error': f'Error reading data: {str(e)}'}))
    
    elif operation == 'add_incremental':
        if len(sys.argv) < 3:
            print(json.dumps({'success': False, 'error': 'No embeddings data provided'}))
            return

        try:
            data_arg = sys.argv[2]

            # Check if it's a file path
            if os.path.isfile(data_arg):
                print(f"Reading from file: {data_arg}", file=sys.stderr)
                with open(data_arg, 'r') as f:
                    embeddings_data = json.load(f)
                print(f"Loaded {len(embeddings_data)} embeddings from file", file=sys.stderr)
            else:
                print(f"Parsing as JSON string", file=sys.stderr)
                embeddings_data = json.loads(data_arg)

            result = faiss_manager.add_incremental(embeddings_data)
            print(json.dumps(result))
        except json.JSONDecodeError as e:
            print(json.dumps({'success': False, 'error': f'Invalid JSON: {str(e)}'}))
        except Exception as e:
            print(json.dumps({'success': False, 'error': f'Error adding incremental: {str(e)}'}))
    
    elif operation == 'rebuild':
        if len(sys.argv) < 3:
            print(json.dumps({'success': False, 'error': 'No embeddings data provided'}))
            return

        try:
            data_arg = sys.argv[2]

            # Check if it's a file path
            if os.path.isfile(data_arg):
                print(f"Reading from file: {data_arg}", file=sys.stderr)
                with open(data_arg, 'r') as f:
                    embeddings_data = json.load(f)
                print(f"Loaded {len(embeddings_data)} embeddings from file", file=sys.stderr)
            else:
                print(f"Parsing as JSON string", file=sys.stderr)
                embeddings_data = json.loads(data_arg)

            result = faiss_manager.rebuild_index(embeddings_data)
            print(json.dumps(result))
        except json.JSONDecodeError as e:
            print(json.dumps({'success': False, 'error': f'Invalid JSON: {str(e)}'}))
        except Exception as e:
            print(json.dumps({'success': False, 'error': f'Error rebuilding index: {str(e)}'}))

if __name__ == '__main__':
    main()