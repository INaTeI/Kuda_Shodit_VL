"""Small learned residual projection over frozen Qwen query embeddings."""
from pathlib import Path
import json
import os
import tempfile

import numpy as np


class QueryAdapter:
    def __init__(self, basis, coefficients, alpha):
        self.basis = np.asarray(basis, dtype=np.float32)
        self.coefficients = np.asarray(coefficients, dtype=np.float32)
        self.alpha = float(alpha)

    def transform(self, vectors):
        projected = vectors + self.alpha * (vectors @ self.basis.T) @ self.coefficients
        return projected / np.maximum(np.linalg.norm(projected, axis=1, keepdims=True), 1e-12)

    def save(self, path, signature, *, approved=False):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        # Atomic create without replacement: training can never overwrite a deployed version.
        with tempfile.NamedTemporaryFile(dir=path.parent, suffix='.npz', delete=False) as stream:
            temporary = Path(stream.name)
        try:
            np.savez_compressed(temporary, basis=self.basis, coefficients=self.coefficients,
                                alpha=np.array(self.alpha), signature=np.array(signature),
                                metadata=np.array(json.dumps(dict(format_version=2,
                                                                 approved=approved is True))))
            os.link(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)

    @classmethod
    def load(cls, path, signature, dimension):
        with np.load(path, allow_pickle=False) as data:
            metadata = json.loads(str(data['metadata'].item())) if 'metadata' in data else {}
            if metadata.get('format_version') != 2 or metadata.get('approved') is not True:
                raise ValueError('Adapter has not passed the current regression gate')
            if str(data['signature'].item()) != signature:
                raise ValueError('Adapter was trained with a different model or catalog')
            adapter = cls(data['basis'], data['coefficients'], data['alpha'].item())
        if (adapter.basis.ndim != 2 or adapter.basis.shape[1] != dimension
                or adapter.coefficients.shape != (adapter.basis.shape[0], dimension)
                or not np.isfinite(adapter.basis).all()
                or not np.isfinite(adapter.coefficients).all()
                or not np.isfinite(adapter.alpha) or not 0 <= adapter.alpha <= 1):
            raise ValueError('Invalid adapter dimensions or values')
        return adapter
