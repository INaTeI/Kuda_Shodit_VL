"""Portable content identity for model, catalog and encoding configuration."""
import hashlib
import json
from pathlib import Path


def content_signature(model_path, catalog, documents, query_prompt, max_length, dtype):
    files = []
    for path in sorted(Path(model_path).rglob('*')):
        if path.is_file():
            digest = hashlib.sha256()
            with path.open('rb') as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                    digest.update(chunk)
            files.append((path.relative_to(model_path).as_posix(), digest.hexdigest()))
    payload = dict(version=2, model_files=files, catalog=catalog, documents=documents,
                   query_prompt=query_prompt, max_length=max_length, dtype=str(dtype),
                   normalize_embeddings=True)
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
