import contextlib
import io
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import configure_upstream_token as setup


class TokenSetupTests(unittest.TestCase):
    def test_hidden_token_saved_without_logging_or_changing_existing_values(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            env = root / ".env.local"
            original = "PROJECT_URL=https://example.test\nSERVICE_ROLE_KEY='local-test'\n"
            env.write_text(original)
            output = io.StringIO()
            calls = [subprocess.CompletedProcess([], 0), subprocess.CompletedProcess([], 1),
                     subprocess.CompletedProcess([], 0, stdout=b"unrelated clipboard")]
            with patch.object(setup, "ROOT", root), patch.object(setup.sys.stdin, "isatty", return_value=True), \
                    patch.object(setup.getpass, "getpass", return_value="local-token-fixture"), \
                    patch.object(setup.subprocess, "run", side_effect=calls), contextlib.redirect_stdout(output):
                setup.main()
            self.assertTrue(env.read_text().startswith(original))
            self.assertIn("UPSTREAM_ACCESS_TOKEN='local-token-fixture'", env.read_text())
            self.assertEqual(env.stat().st_mode & 0o777, 0o600)
            self.assertNotIn("local-token-fixture", output.getvalue())

    def test_full_cookie_header_or_named_cookie_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            env = root / ".env.local"
            env.write_text("PROJECT_URL=https://example.test\nSERVICE_ROLE_KEY=test\n")
            original = env.read_text()
            for token in ("access_token=fixture", "access_token=fixture; cf_clearance=forbidden", "cf_clearance=forbidden"):
                calls = [subprocess.CompletedProcess([], 0), subprocess.CompletedProcess([], 1)]
                with patch.object(setup, "ROOT", root), patch.object(setup.sys.stdin, "isatty", return_value=True), \
                        patch.object(setup.getpass, "getpass", return_value=token), \
                        patch.object(setup.subprocess, "run", side_effect=calls):
                    with self.assertRaises(RuntimeError):
                        setup.main()
                self.assertEqual(env.read_text(), original)

    def test_noninteractive_input_is_rejected(self):
        with patch.object(setup.sys.stdin, "isatty", return_value=False):
            with self.assertRaises(RuntimeError):
                setup.main()


if __name__ == "__main__":
    unittest.main()
