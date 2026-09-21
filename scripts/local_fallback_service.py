#!/usr/bin/env python3
"""Install and control the current user's 15-minute Mac fallback LaunchAgent."""

import argparse
import os
import plistlib
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LABEL = "com.spyconverter.local-fallback"
DOMAIN = f"gui/{os.getuid()}"
SERVICE = f"{DOMAIN}/{LABEL}"
PLIST = Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"
STATE = ROOT / ".local-fallback"


def launchctl(*args):
    return subprocess.run(["/bin/launchctl", *args], capture_output=True, text=True)


def configuration():
    return {
        "Label": LABEL,
        "ProgramArguments": [sys.executable, str(ROOT / "scripts/local_fallback.py"), "--scheduled"],
        "WorkingDirectory": str(ROOT),
        "StartInterval": 900,
        "RunAtLoad": True,
        "ProcessType": "Background",
        "LowPriorityIO": True,
        "Umask": 0o077,
        "StandardOutPath": str(STATE / "launchd.log"),
        "StandardErrorPath": str(STATE / "launchd.log"),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("install", "start", "stop", "status", "run", "logs"))
    command = parser.parse_args().command
    if command == "logs":
        path = STATE / "fallback.log"
        if path.exists():
            # Bounded even when the file contains many runs.
            print("\n".join(path.read_text().splitlines()[-80:]))
        else:
            print("No operational log yet.")
        return 0
    if command == "install":
        STATE.mkdir(mode=0o700, exist_ok=True)
        PLIST.parent.mkdir(parents=True, exist_ok=True)
        PLIST.write_bytes(plistlib.dumps(configuration()))
        PLIST.chmod(0o600)
        # Reload this one job only; no other LaunchAgents are touched.
        launchctl("bootout", SERVICE)
        command = "start"
    if command == "start":
        if not PLIST.exists():
            print("Install first: python3 scripts/local_fallback_service.py install")
            return 1
        if launchctl("enable", SERVICE).returncode:
            print("launchd enable failed; interactive macOS permissions may be required.")
            return 1
        if launchctl("print", SERVICE).returncode:
            if launchctl("bootstrap", DOMAIN, str(PLIST)).returncode:
                print("launchd bootstrap failed; interactive macOS permissions may be required.")
                return 1
        print("LaunchAgent enabled: after login and every 900 seconds while awake.")
    elif command == "stop":
        disabled = launchctl("disable", SERVICE)
        launchctl("bootout", SERVICE)
        print("LaunchAgent stopped and disabled." if not disabled.returncode else "launchd disable failed.")
        return 1 if disabled.returncode else 0
    elif command == "run":
        # No -k: never kill an already running updater.
        result = launchctl("kickstart", SERVICE)
        print("Run requested (an active run is left intact)." if not result.returncode else "LaunchAgent is not started.")
        return 1 if result.returncode else 0
    result = launchctl("print", SERVICE)
    if result.returncode:
        print("LaunchAgent is not loaded.")
        return 1
    print("LaunchAgent loaded; interval=900 seconds.")
    for line in result.stdout.splitlines():
        if line.strip().startswith(("state =", "runs =", "last exit code =", "pid =", "run interval =")):
            print(line.strip())
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        print("Service control failed; no sensitive diagnostics logged.", file=sys.stderr)
        sys.exit(1)
