import tempfile
import unittest
from pathlib import Path

import numpy as np

from query_adapter import QueryAdapter


class QueryAdapterTest(unittest.TestCase):
    def test_serialization_preserves_predictions_and_unit_norm(self):
        adapter = QueryAdapter([[1, 0]], [[0, 1]], 0.5)
        query = np.array([[1, 0]], dtype=np.float32)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'adapter.npz'
            adapter.save(path, 'model-signature', approved=True)
            loaded = QueryAdapter.load(path, 'model-signature', 2)
            result = loaded.transform(query)
        np.testing.assert_allclose(result, [[1/np.sqrt(1.25), 0.5/np.sqrt(1.25)]], rtol=1e-6)
        np.testing.assert_allclose(np.linalg.norm(result, axis=1), 1, rtol=1e-6)

    def test_stale_model_or_catalog_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'adapter.npz'
            QueryAdapter([[1, 0]], [[0, 1]], 0.5).save(path, 'old', approved=True)
            with self.assertRaises(ValueError):
                QueryAdapter.load(path, 'new', 2)

    def test_invalid_dimensions_and_nonfinite_weights_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'adapter.npz'
            for coefficients in ([[1, 2, 3]], [[float('nan'), 0]]):
                path.unlink(missing_ok=True)
                QueryAdapter([[1, 0]], coefficients, 0.5).save(path, 'same', approved=True)
                with self.assertRaises(ValueError):
                    QueryAdapter.load(path, 'same', 2)

    def test_unapproved_candidate_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'candidate.npz'
            QueryAdapter([[1, 0]], [[0, 1]], 0.5).save(path, 'same', approved=False)
            with self.assertRaisesRegex(ValueError, 'regression gate'):
                QueryAdapter.load(path, 'same', 2)

    def test_training_never_overwrites_an_existing_version(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'active.npz'
            adapter = QueryAdapter([[1, 0]], [[0, 1]], 0.5)
            adapter.save(path, 'same', approved=True)
            original = path.read_bytes()
            with self.assertRaises(FileExistsError):
                adapter.save(path, 'different', approved=False)
            self.assertEqual(path.read_bytes(), original)


if __name__ == '__main__':
    unittest.main()
