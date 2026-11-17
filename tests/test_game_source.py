import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('game_source', 'scripts/game-source.py')
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)

class BundleValidationTest(unittest.TestCase):
    def fixture(self, root):
        root = Path(root)
        (root / 'src').mkdir()
        (root / 'assets').mkdir()
        (root / 'assets' / 'texture').write_bytes(b'game asset')
        (root / 'src/settings.json').write_text('{}')
        (root / 'application.js').write_text('function init(engine) { cc = engine; }')
        (root / 'index.html').write_text('<title>PvZ2 Gardendless Online | 0.16.6</title>')
        return root

    def test_version_from_actual_game_not_website(self):
        with tempfile.TemporaryDirectory() as temp:
            self.assertEqual(source.validate(self.fixture(temp)), '0.16.6')

    def test_incomplete_or_incompatible_bundle_blocks_release(self):
        for missing in ['index.html', 'application.js', 'src/settings.json', 'assets/texture']:
            with self.subTest(missing=missing), tempfile.TemporaryDirectory() as temp:
                root = self.fixture(temp)
                (root / missing).unlink()
                with self.assertRaises(ValueError): source.validate(root)
        with tempfile.TemporaryDirectory() as temp:
            root = self.fixture(temp)
            (root / 'application.js').write_text('different bootstrap')
            with self.assertRaises(ValueError): source.validate(root)
