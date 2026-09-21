#!/usr/bin/env python3
"""Save one authorized application token locally, using a hidden terminal prompt."""

import getpass
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    target = ROOT / ".env.local"
    if not sys.stdin.isatty():
        raise RuntimeError("Run this command in an interactive Terminal for hidden input.")
    ignored = subprocess.run(
        ["git", "check-ignore", "--quiet", ".env.local"], cwd=ROOT,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    tracked = subprocess.run(
        ["git", "ls-files", "--error-unmatch", ".env.local"], cwd=ROOT,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    if ignored.returncode != 0 or tracked.returncode == 0:
        raise RuntimeError("Root .env.local must be ignored and untracked before setup.")
    if target.is_symlink() or not target.is_file():
        raise RuntimeError("Create a regular root .env.local with backend credentials first.")
    # Require a functioning hidden prompt: never fall back to echoed stdin.
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("error", getpass.GetPassWarning)
        token = getpass.getpass("Paste only the SaveTicker access_token value (hidden): ").strip()
    # RFC cookie-octet, excluding quote/backslash and all separators/whitespace.
    if (not token or token.startswith(("access_token=", "cf_clearance="))
            or not re.fullmatch(r"[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]+", token)):
        raise RuntimeError("Invalid token input; paste only the cookie value, not a header.")
    # Write a quoted dotenv value; no shell expansion is used by the updater.
    assignment = "UPSTREAM_ACCESS_TOKEN='" + token.replace("'", "'\"'\"'") + "'"
    lines = target.read_text(encoding="utf-8").splitlines()
    lines = [line for line in lines
             if not re.match(r"^\s*(?:export\s+)?UPSTREAM_ACCESS_TOKEN\s*=", line)]
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=ROOT,
                                         prefix=".env.local.", delete=False) as handle:
            temporary = Path(handle.name)
            os.fchmod(handle.fileno(), 0o600)
            handle.write("\n".join(lines + [assignment]) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(target)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    # If the user copied exactly this value, remove our token from the clipboard.
    # Do not clear unrelated clipboard contents.
    try:
        clipboard = subprocess.run(["/usr/bin/pbpaste"], capture_output=True, timeout=3)
        if clipboard.stdout.decode("utf-8").strip() == token:
            subprocess.run(["/usr/bin/pbcopy"], input=b"", check=True, timeout=3)
    except (OSError, subprocess.SubprocessError, UnicodeError):
        pass
    print("Saved UPSTREAM_ACCESS_TOKEN in root .env.local with owner-only permissions.")


if __name__ == "__main__":
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        print("Cancelled; token was not saved.", file=sys.stderr)
        sys.exit(1)
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print("Local token setup failed; no sensitive diagnostics logged.", file=sys.stderr)
        sys.exit(1)
