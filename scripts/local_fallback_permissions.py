"""Private-file permissions for fallback state and locally entered credentials."""

import os


def make_private(handle):
    """Restrict an open file to its owner before any sensitive content is written."""
    if os.name != "nt":
        os.fchmod(handle.fileno(), 0o600)
        return

    import ctypes
    import msvcrt
    from ctypes import wintypes

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    security = ctypes.WinDLL("advapi32", use_last_error=True)
    kernel.ReOpenFile.argtypes = [wintypes.HANDLE, wintypes.DWORD,
                                 wintypes.DWORD, wintypes.DWORD]
    kernel.ReOpenFile.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle.restype = wintypes.BOOL
    kernel.LocalFree.argtypes = [wintypes.HLOCAL]
    kernel.LocalFree.restype = wintypes.HLOCAL
    security.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = [
        wintypes.LPCWSTR, wintypes.DWORD, ctypes.POINTER(ctypes.c_void_p),
        ctypes.POINTER(wintypes.DWORD)]
    security.ConvertStringSecurityDescriptorToSecurityDescriptorW.restype = wintypes.BOOL
    security.GetSecurityDescriptorDacl.argtypes = [ctypes.c_void_p,
        ctypes.POINTER(wintypes.BOOL), ctypes.POINTER(ctypes.c_void_p),
        ctypes.POINTER(wintypes.BOOL)]
    security.GetSecurityDescriptorDacl.restype = wintypes.BOOL
    security.SetSecurityInfo.argtypes = [wintypes.HANDLE, ctypes.c_int, wintypes.DWORD,
        ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p]
    security.SetSecurityInfo.restype = wintypes.DWORD

    # Reopen this exact file object with READ_CONTROL | WRITE_DAC, avoiding a path race.
    secured = kernel.ReOpenFile(msvcrt.get_osfhandle(handle.fileno()), 0x60000, 7, 0)
    if secured == ctypes.c_void_p(-1).value:
        raise PermissionError("Could not secure local file permissions.")
    descriptor = ctypes.c_void_p()
    try:
        # Protected DACL: remove inherited access and grant only the file owner.
        if not security.ConvertStringSecurityDescriptorToSecurityDescriptorW(
                "D:P(A;;FA;;;OW)", 1, ctypes.byref(descriptor), None):
            raise PermissionError("Could not secure local file permissions.")
        present, defaulted = wintypes.BOOL(), wintypes.BOOL()
        dacl = ctypes.c_void_p()
        if (not security.GetSecurityDescriptorDacl(descriptor, ctypes.byref(present),
                                                  ctypes.byref(dacl), ctypes.byref(defaulted))
                or not present.value or not dacl.value):
            raise PermissionError("Could not secure local file permissions.")
        # SE_FILE_OBJECT; DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION.
        if security.SetSecurityInfo(secured, 1, 0x80000004, None, None, dacl, None):
            raise PermissionError("Could not secure local file permissions.")
    finally:
        if descriptor:
            kernel.LocalFree(descriptor)
        kernel.CloseHandle(secured)
