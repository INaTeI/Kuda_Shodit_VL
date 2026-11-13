import os
from pathlib import Path
import tempfile
import unittest

from model_identity import content_signature


class ModelIdentityTest(unittest.TestCase):
    def test_copy_and_timestamp_do_not_change_identity_but_content_does(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            a, b = root/'a', root/'b'
            a.mkdir()
            b.mkdir()
            (a/'weights').write_bytes(b'original')
            (b/'weights').write_bytes(b'original')
            os.utime(b/'weights', (100, 100))
            def signature(path, prompt='query', length=1024):
                return content_signature(path, [{'place_id': '1'}], ['doc'], prompt, length, 'float32')
            original = signature(a)
            self.assertEqual(original, signature(b))
            self.assertNotEqual(original, signature(a, prompt='changed'))
            self.assertNotEqual(original, signature(a, length=512))
            (b/'weights').write_bytes(b'modified')
            self.assertNotEqual(original, signature(b))


if __name__ == '__main__':
    unittest.main()
