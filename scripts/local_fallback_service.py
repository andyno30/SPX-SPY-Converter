#!/usr/bin/env python3
"""Control the current user's 15-minute fallback LaunchAgent or Windows task."""

import argparse
import csv
import io
import os
import plistlib
import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

ROOT = Path(__file__).resolve().parents[1]
LABEL = "com.spyconverter.local-fallback"
DOMAIN = f"gui/{os.getuid()}" if sys.platform != "win32" else None
SERVICE = f"{DOMAIN}/{LABEL}"
PLIST = Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"
STATE = ROOT / ".local-fallback"


def windows_configuration():
    """No credentials enter the task; the updater reads the root .env.local."""
    # pythonw is the same interpreter without a console window. Running it
    # directly also lets Task Scheduler stop the updater itself, not a wrapper.
    executable = Path(sys.executable).with_name("pythonw.exe")
    if not executable.is_file():
        raise ValueError("Windows scheduling requires pythonw.exe beside this Python interpreter.")
    try:
        ZoneInfo("America/Los_Angeles")
    except ZoneInfoNotFoundError:
        raise ValueError("Install the tzdata package in this Python interpreter before scheduling.") from None
    task = ET.Element("Task", version="1.2", xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task")

    def add(parent, name, value=None):
        element = ET.SubElement(parent, name)
        element.text = value
        return element

    registration = add(task, "RegistrationInfo")
    add(registration, "Description", f"SpyConverter local fallback: {ROOT}")
    triggers = add(task, "Triggers")
    timer = add(triggers, "TimeTrigger")
    repetition = add(timer, "Repetition")
    add(repetition, "Interval", "PT15M")
    add(repetition, "StopAtDurationEnd", "false")
    add(timer, "StartBoundary", (datetime.now().astimezone() + timedelta(minutes=15)).isoformat(timespec="seconds"))
    add(timer, "Enabled", "true")
    logon = add(triggers, "LogonTrigger")
    add(logon, "Enabled", "true")
    add(logon, "UserId", "__CURRENT_USER_SID__")
    principal = add(add(task, "Principals"), "Principal")
    principal.set("id", "CurrentUser")
    add(principal, "UserId", "__CURRENT_USER_SID__")
    add(principal, "LogonType", "InteractiveToken")
    add(principal, "RunLevel", "LeastPrivilege")
    settings = add(task, "Settings")
    for name, value in (
        ("MultipleInstancesPolicy", "IgnoreNew"),
        ("DisallowStartIfOnBatteries", "false"),
        ("StopIfGoingOnBatteries", "false"),
        ("StartWhenAvailable", "true"),
        ("AllowStartOnDemand", "true"),
        ("Enabled", "true"),
        ("Hidden", "true"),
        # The updater enforces its own 600-second deadline. This is a backup.
        ("ExecutionTimeLimit", "PT10M"),
    ):
        add(settings, name, value)
    actions = add(task, "Actions")
    actions.set("Context", "CurrentUser")
    action = add(actions, "Exec")
    add(action, "Command", str(executable))
    add(action, "Arguments", subprocess.list2cmdline([str(ROOT / "scripts/local_fallback.py"), "--scheduled"]))
    add(action, "WorkingDirectory", str(ROOT))
    return ET.tostring(task, encoding="unicode")


def windows_command(program, *args):
    executable = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / program
    return subprocess.run(
        [str(executable), *args], capture_output=True, stdin=subprocess.DEVNULL,
        timeout=30, creationflags=subprocess.CREATE_NO_WINDOW,
    )


def windows_output(result):
    # schtasks XML can be UTF-16; native CSV uses the Windows console code page.
    data = result.stdout
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        return data.decode("utf-16")
    if b"\x00" in data[:100]:
        return data.decode("utf-16le")
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return data.decode("oem", errors="replace")


def windows_task(name, user_id, account=""):
    result = windows_command("schtasks.exe", "/Query", "/TN", name, "/XML")
    if result.returncode:
        return None
    task = ET.fromstring(windows_output(result))
    ns = {"t": "http://schemas.microsoft.com/windows/2004/02/mit/task"}
    expected = {
        "t:RegistrationInfo/t:Description": f"SpyConverter local fallback: {ROOT}",
        "t:Principals/t:Principal/t:UserId": user_id,
        "t:Principals/t:Principal/t:LogonType": "InteractiveToken",
        "t:Actions/t:Exec/t:Command": str(Path(sys.executable).with_name("pythonw.exe")),
        "t:Actions/t:Exec/t:Arguments": subprocess.list2cmdline([str(ROOT / "scripts/local_fallback.py"), "--scheduled"]),
        "t:Actions/t:Exec/t:WorkingDirectory": str(ROOT),
        "t:Settings/t:MultipleInstancesPolicy": "IgnoreNew",
        "t:Settings/t:ExecutionTimeLimit": "PT10M",
        "t:Settings/t:StartWhenAvailable": "true",
        "t:Settings/t:DisallowStartIfOnBatteries": "false",
        "t:Settings/t:StopIfGoingOnBatteries": "false",
        "t:Triggers/t:TimeTrigger/t:Repetition/t:Interval": "PT15M",
    }
    if (any(task.findtext(path, namespaces=ns) != value for path, value in expected.items())
            # Task Scheduler omits the default level and can export the logon
            # user as its account name instead of its equivalent SID.
            or task.findtext("t:Principals/t:Principal/t:RunLevel", default="LeastPrivilege", namespaces=ns) != "LeastPrivilege"
            or task.findtext("t:Triggers/t:LogonTrigger/t:UserId", default="", namespaces=ns).casefold() not in {value.casefold() for value in (user_id, account) if value}
            or len(task.findall("t:Actions/*", ns)) != 1
            or len(task.findall("t:Triggers/*", ns)) != 2
            or task.find("t:Triggers/t:TimeTrigger/t:Repetition/t:Duration", ns) is not None):
        raise ValueError("Windows task configuration differs; no further changes were made.")
    return {"enabled": task.findtext("t:Settings/t:Enabled", default="true", namespaces=ns) == "true"}


def windows_status(name, status):
    result = windows_command("schtasks.exe", "/Query", "/TN", name, "/V", "/FO", "CSV", "/NH")
    if result.returncode:
        return
    for row in csv.reader(io.StringIO(windows_output(result))):
        # Columns are stable even when their headings/values are localized.
        # Never display task actions, paths, accounts, or unrestricted strings.
        if len(row) < 7 or row[1].lstrip("\\") != name:
            continue
        states = {"ready", "running", "queued", "disabled", "unknown"}
        state = row[3].lower()
        status["state"] = state if state in states else "unknown"
        if re.fullmatch(r"-?[0-9]+", row[6]):
            status["last_exit"] = int(row[6])
        for key, index in (("next_run", 2), ("last_run", 5)):
            value = row[index].upper()
            if len(value) <= 60 and re.fullmatch(r"[0-9:/ .TAMP-]+", value):
                status[key] = value
        return


def windows_service(command):
    try:
        xml = windows_configuration() if command in ("install", "start") else None
        identity = windows_command("whoami.exe", "/user", "/fo", "csv", "/nh")
        if identity.returncode:
            raise OSError
        rows = list(csv.reader(io.StringIO(windows_output(identity))))
        if len(rows) != 1 or len(rows[0]) != 2 or not re.fullmatch(r"S-1-(?:[0-9]+-)*[0-9]+", rows[0][1]):
            raise OSError
        user_id = rows[0][1]
        account = rows[0][0]
        name = f"{LABEL}-{user_id}"
        status = windows_task(name, user_id, account)
        start_run = False
        if command in ("install", "start"):
            if status is None:
                STATE.mkdir(mode=0o700, exist_ok=True)
                descriptor, filename = tempfile.mkstemp(prefix="task-", suffix=".xml", dir=STATE)
                try:
                    with os.fdopen(descriptor, "w", encoding="utf-16") as handle:
                        handle.write(xml.replace("__CURRENT_USER_SID__", user_id))
                    # No /F: never replace a task that appeared concurrently.
                    created = windows_command("schtasks.exe", "/Create", "/TN", name, "/XML", filename)
                    if created.returncode:
                        raise OSError
                finally:
                    Path(filename).unlink(missing_ok=True)
                start_run = True
            elif not status["enabled"]:
                if windows_command("schtasks.exe", "/Change", "/TN", name, "/Enable").returncode:
                    raise OSError
                start_run = True
        elif status is None:
            print("Windows task is not installed or unavailable; use start to install.")
            return 1
        if command == "stop":
            if windows_command("schtasks.exe", "/Change", "/TN", name, "/Disable").returncode:
                raise OSError
            if windows_command("schtasks.exe", "/End", "/TN", name).returncode:
                raise OSError
        elif command == "run" or start_run:
            if command == "run" and not status["enabled"]:
                print("Windows task is disabled; use start.")
                return 1
            # IgnoreNew leaves an existing instance intact; never end it first.
            if windows_command("schtasks.exe", "/Run", "/TN", name).returncode:
                raise OSError
        status = windows_task(name, user_id, account)
        if status is None:
            raise OSError
        windows_status(name, status)
    except ValueError as error:
        # Our validation errors contain only constant diagnostics.
        if str(error) in (
            "Windows task configuration differs; no further changes were made.",
            "Windows scheduling requires pythonw.exe beside this Python interpreter.",
            "Install the tzdata package in this Python interpreter before scheduling.",
        ):
            print(str(error))
        else:
            print("Windows Task Scheduler control failed; no sensitive diagnostics logged.")
        return 1
    except (OSError, subprocess.TimeoutExpired, ET.ParseError, csv.Error):
        print("Windows Task Scheduler control failed; no sensitive diagnostics logged.")
        return 1
    print({
        "install": "Windows task enabled: after login and every 900 seconds while logged in and awake.",
        "start": "Windows task enabled: after login and every 900 seconds while logged in and awake.",
        "stop": "Windows task stopped and disabled.",
        "run": "Run requested (an active run is left intact).",
        "status": "Windows task installed; interval=900 seconds.",
    }[command])
    print(f"state = {status.get('state', 'unknown') if status['enabled'] else 'disabled'}")
    print(f"enabled = {status['enabled']}")
    for key, label in (("last_exit", "last exit code"), ("last_run", "last run"), ("next_run", "next run")):
        if key in status:
            print(f"{label} = {status[key]}")
    return 0


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
    if sys.platform == "win32":
        for stream in (sys.stdout, sys.stderr):
            if stream is not None and hasattr(stream, "reconfigure"):
                stream.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("install", "start", "stop", "status", "run", "logs"))
    command = parser.parse_args().command
    if command == "logs":
        path = STATE / "fallback.log"
        if path.exists():
            # Bounded even when the file contains many runs.
            content = path.read_text(encoding="utf-8", errors="replace") if sys.platform == "win32" else path.read_text()
            print("\n".join(content.splitlines()[-80:]))
        else:
            print("No operational log yet.")
        return 0
    if sys.platform == "win32":
        return windows_service(command)
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
