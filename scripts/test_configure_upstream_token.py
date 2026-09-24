import contextlib
import ctypes
import io
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import configure_upstream_token as setup
from test_local_fallback_permissions import assert_private_file


class TokenSetupTests(unittest.TestCase):
    def test_hidden_token_saved_without_logging_or_changing_existing_values(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            env = root / ".env.local"
            original = "PROJECT_URL=https://example.test\nSERVICE_ROLE_KEY='local-test'\n"
            env.write_text(original)
            output = io.StringIO()
            calls = [subprocess.CompletedProcess([], 0), subprocess.CompletedProcess([], 1)]
            with patch.object(setup, "ROOT", root), patch.object(setup.sys.stdin, "isatty", return_value=True), \
                    patch.object(setup.getpass, "getpass", return_value="local-token-fixture"), \
                    patch.object(setup.subprocess, "run", side_effect=calls), \
                    patch.object(setup, "_clear_token_clipboard") as clear_clipboard, \
                    contextlib.redirect_stdout(output):
                setup.main()
            self.assertTrue(env.read_text().startswith(original))
            self.assertIn("UPSTREAM_ACCESS_TOKEN='local-token-fixture'", env.read_text())
            assert_private_file(self, env)
            self.assertNotIn("local-token-fixture", output.getvalue())
            clear_clipboard.assert_called_once_with("local-token-fixture")

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

    def test_permission_failure_leaves_original_config_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            env = root / ".env.local"
            original = "PROJECT_URL=https://example.test\nSERVICE_ROLE_KEY=test\n"
            env.write_text(original)
            calls = [subprocess.CompletedProcess([], 0), subprocess.CompletedProcess([], 1)]
            with patch.object(setup, "ROOT", root), \
                    patch.object(setup.sys.stdin, "isatty", return_value=True), \
                    patch.object(setup.getpass, "getpass", return_value="local-token-fixture"), \
                    patch.object(setup.subprocess, "run", side_effect=calls), \
                    patch.object(setup, "make_private", side_effect=PermissionError("denied")):
                with self.assertRaises(PermissionError):
                    setup.main()
            self.assertEqual(env.read_text(), original)
            self.assertEqual(list(root.iterdir()), [env])

    def test_windows_clipboard_clears_only_matching_token_without_subprocesses(self):
        for value in ("local-token-fixture", "unrelated clipboard"):
            with self.subTest(value=value):
                user, kernel = Mock(), Mock()
                user.OpenClipboard.return_value = True
                user.GetClipboardData.return_value = 123
                buffer = ctypes.create_unicode_buffer(value)
                kernel.GlobalLock.return_value = ctypes.addressof(buffer)
                with patch.object(setup.os, "name", "nt"), \
                        patch.object(ctypes, "WinDLL", create=True,
                                     side_effect=[user, kernel]), \
                        patch.object(setup.subprocess, "run") as run:
                    setup._clear_token_clipboard("local-token-fixture")
                self.assertEqual(user.EmptyClipboard.call_count, int(value == "local-token-fixture"))
                user.CloseClipboard.assert_called_once_with()
                kernel.GlobalUnlock.assert_called_once_with(123)
                run.assert_not_called()

    def test_windows_busy_clipboard_is_left_alone(self):
        user, kernel = Mock(), Mock()
        user.OpenClipboard.return_value = False
        with patch.object(ctypes, "WinDLL", create=True, side_effect=[user, kernel]):
            setup._clear_windows_token_clipboard("local-token-fixture")
        user.GetClipboardData.assert_not_called()
        user.EmptyClipboard.assert_not_called()
        user.CloseClipboard.assert_not_called()

    def test_macos_clipboard_commands_are_unchanged(self):
        calls = [subprocess.CompletedProcess([], 0, stdout=b"local-token-fixture"),
                 subprocess.CompletedProcess([], 0)]
        with patch.object(setup.os, "name", "posix"), \
                patch.object(setup.subprocess, "run", side_effect=calls) as run:
            setup._clear_token_clipboard("local-token-fixture")
        self.assertEqual(run.call_args_list[0].args, (["/usr/bin/pbpaste"],))
        self.assertEqual(run.call_args_list[0].kwargs, {"capture_output": True, "timeout": 3})
        self.assertEqual(run.call_args_list[1].args, (["/usr/bin/pbcopy"],))
        self.assertEqual(run.call_args_list[1].kwargs, {"input": b"", "check": True, "timeout": 3})


if __name__ == "__main__":
    unittest.main()
