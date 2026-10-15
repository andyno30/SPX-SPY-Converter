import contextlib
import getpass
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
import warnings

import configure_upstream_clearance as setup


class ClearanceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.target = self.root / setup.RELATIVE
        self.root_patch = patch.object(setup, 'ROOT', self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)

    def save(self):
        with patch.object(setup, 'verify_location', return_value=self.target):
            setup.save_cookie('private-fixture-clearance')

    def test_only_one_cookie_private_atomic_no_backend_changes(self):
        env = self.root / '.env.local'
        env.write_text('untouched-backend-fixture')
        self.save()
        self.assertEqual(self.target.stat().st_mode & 0o777, 0o600)
        cookie = setup.load_cookie_for_verification()
        self.assertEqual(cookie['name'], 'cf_clearance')
        self.assertEqual(cookie['domain'], '.saveticker.com')
        self.assertEqual(cookie['value'], 'private-fixture-clearance')
        self.assertEqual(env.read_text(), 'untouched-backend-fixture')
        self.assertEqual(list(self.target.parent.iterdir()), [self.target])

    def test_invalid_values_never_echo_contents(self):
        for value in ('', 'short', 'cf_clearance=private-fixture', 'Cookie: private-fixture',
                      'private-fixture; access_token=bad', 'private-fixture\nsecret',
                      '{"cookies":[]}', 'x' * 4097):
            with self.subTest(value_length=len(value)), self.assertRaises(setup.ClearanceError) as error:
                setup.validate_value(value)
            if value:
                self.assertNotIn(value, str(error.exception))

    def test_git_ignore_and_untracked_are_both_required(self):
        for codes in ((1,), (0, 0), (0, 128)):
            with self.subTest(codes=codes), patch.object(setup.subprocess, 'run',
                    side_effect=[Mock(returncode=c) for c in codes]):
                with self.assertRaises(setup.ClearanceError):
                    setup.verify_location()

    def test_symlinks_are_rejected(self):
        destination = self.root / 'elsewhere'
        destination.mkdir()
        self.target.parent.symlink_to(destination)
        with patch.object(setup.subprocess, 'run', side_effect=[Mock(returncode=0), Mock(returncode=1)]):
            with self.assertRaises(setup.ClearanceError):
                setup.verify_location()
        with self.assertRaises(setup.ClearanceError):
            setup.load_cookie_for_verification()

    def test_file_symlink_and_public_permissions_rejected(self):
        self.save()
        self.target.chmod(0o644)
        with self.assertRaises(setup.ClearanceError):
            setup.load_cookie_for_verification()
        alternate = self.target.with_name('alternate')
        self.target.rename(alternate)
        self.target.symlink_to(alternate)
        with self.assertRaises(setup.ClearanceError):
            setup.load_cookie_for_verification()

    def test_stale_import_and_changed_cookie_scope_rejected(self):
        self.save()
        original = json.loads(self.target.read_text())
        changes = [dict(original, imported_at=0), dict(original, imported_at=float('nan')),
                   dict(original, cookie=dict(original['cookie'], domain='.example.com')),
                   dict(original, cookie=dict(original['cookie'], name='access_token')),
                   dict(original, cookie=dict(original['cookie'], secure=1)),
                   dict(original, unrelated_cookie='private-fixture')]
        for record in changes:
            self.target.write_text(json.dumps(record))
            with self.assertRaises(setup.ClearanceError):
                setup.load_cookie_for_verification()

    def test_hidden_prompt_refuses_echo_fallback_and_noninteractive_input(self):
        with patch.object(setup.sys, 'argv', ['helper']), patch.object(setup.sys.stdin, 'isatty', return_value=False):
            with self.assertRaises(setup.ClearanceError):
                setup.main()
        with patch.object(setup.sys, 'argv', ['helper']), patch.object(setup.sys.stdin, 'isatty', return_value=True), \
                patch.object(setup, 'verify_location'), patch.object(setup.getpass, 'getpass',
                    side_effect=lambda _: warnings.warn('fixture warning', getpass.GetPassWarning)):
            with self.assertRaises(getpass.GetPassWarning):
                setup.main()
        self.assertFalse(self.target.exists())

    def test_success_prints_no_cookie_and_clears_only_copied_value(self):
        output = io.StringIO()
        with patch.object(setup.sys, 'argv', ['helper']), patch.object(setup.sys.stdin, 'isatty', return_value=True), \
                patch.object(setup, 'verify_location', return_value=self.target), \
                patch.object(setup.getpass, 'getpass', return_value='private-fixture-clearance'), \
                patch.object(setup, '_clear_token_clipboard') as clear, contextlib.redirect_stdout(output):
            setup.main()
        self.assertNotIn('private-fixture-clearance', output.getvalue())
        clear.assert_called_once_with('private-fixture-clearance')
        self.assertIn('Production remains unchanged', output.getvalue())


if __name__ == '__main__':
    unittest.main()
