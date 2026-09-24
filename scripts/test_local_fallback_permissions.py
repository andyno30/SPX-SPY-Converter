import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import local_fallback_permissions as permissions


def assert_private_file(testcase, path):
    if os.name != "nt":
        testcase.assertEqual(path.stat().st_mode & 0o777, 0o600)
        return

    import ctypes
    from ctypes import wintypes

    security = ctypes.WinDLL("advapi32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    security.GetNamedSecurityInfoW.argtypes = [wintypes.LPWSTR, ctypes.c_int,
        wintypes.DWORD, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p,
        ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)]
    security.GetNamedSecurityInfoW.restype = wintypes.DWORD
    security.ConvertSecurityDescriptorToStringSecurityDescriptorW.argtypes = [
        ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD,
        ctypes.POINTER(wintypes.LPWSTR), ctypes.c_void_p]
    security.ConvertSecurityDescriptorToStringSecurityDescriptorW.restype = wintypes.BOOL
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    descriptor, text = ctypes.c_void_p(), wintypes.LPWSTR()
    try:
        testcase.assertEqual(security.GetNamedSecurityInfoW(
            str(path), 1, 4, None, None, None, None, ctypes.byref(descriptor)), 0)
        testcase.assertTrue(security.ConvertSecurityDescriptorToStringSecurityDescriptorW(
            descriptor, 1, 4, ctypes.byref(text), None))
        testcase.assertRegex(text.value, r"^D:P(?:AI)?\(A;;FA;;;OW\)$")
    finally:
        if text:
            kernel.LocalFree(text)
        if descriptor:
            kernel.LocalFree(descriptor)


class PrivateFileTests(unittest.TestCase):
    def test_permissions_survive_atomic_replace_and_reopen(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "state.json"
            destination.write_text("old")
            with tempfile.NamedTemporaryFile(mode="w", dir=directory, delete=False) as handle:
                temporary = Path(handle.name)
                permissions.make_private(handle)
                assert_private_file(self, temporary)
                handle.write("private-fixture")
            temporary.replace(destination)
            self.assertEqual(destination.read_text(), "private-fixture")
            assert_private_file(self, destination)

    def test_posix_uses_the_existing_fchmod_call(self):
        handle = Mock()
        handle.fileno.return_value = 91
        with patch.object(permissions.os, "name", "posix"), \
                patch.object(permissions.os, "fchmod", create=True) as fchmod:
            permissions.make_private(handle)
        fchmod.assert_called_once_with(91, 0o600)


if __name__ == "__main__":
    unittest.main()
