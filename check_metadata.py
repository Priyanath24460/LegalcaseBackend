import pickle

with open('legal_metadata.pkl', 'rb') as f:
    metadata = pickle.load(f)

print(f'FAISS metadata has {len(metadata)} items')
print('\nSample sections:')
for i, m in enumerate(metadata[:5]):
    print(f'{i+1}. Section: {m.get("section_id")}, Case: {m.get("case_id")}')
    print(f'   Text: {m.get("text", "")[:80]}...')
