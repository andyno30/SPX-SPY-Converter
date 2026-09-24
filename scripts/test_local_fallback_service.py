import contextlib
import io
import csv
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import call, patch

import local_fallback_service as service


class WindowsServiceTests(unittest.TestCase):
    def setUp(self):
        self.output = io.StringIO()
        self.quiet = contextlib.redirect_stdout(self.output)
        self.quiet.__enter__()
        self.addCleanup(self.quiet.__exit__, None, None, None)
        self.platform = patch.object(service.sys, "platform", "win32")
        self.platform.start()
        self.addCleanup(self.platform.stop)
        self.flags = patch.object(service.subprocess, "CREATE_NO_WINDOW", 0x08000000, create=True)
        self.flags.start()
        self.addCleanup(self.flags.stop)

    @staticmethod
    def result(stdout=b"", returncode=0):
        return SimpleNamespace(returncode=returncode, stdout=stdout, stderr=b"synthetic-secret")

    def task_xml(self, enabled=True):
        with patch.object(service.Path, "is_file", return_value=True):
            task = ET.fromstring(service.windows_configuration().replace("__CURRENT_USER_SID__", "S-1-5-21-123"))
        task.find("{*}Settings/{*}Enabled").text = str(enabled).lower()
        return ET.tostring(task, encoding="utf-16")

    def scheduler(self, installed=True, enabled=True):
        owner = self

        class Scheduler:
            def __init__(self):
                self.xml = owner.task_xml(enabled) if installed else None
                self.calls = []
                self.create_fails = False
                self.state = "Ready" if enabled else "Disabled"

            def __call__(self, program, *args):
                self.calls.append((program, *args))
                if program == "whoami.exe":
                    return owner.result(b'"synthetic-secret","S-1-5-21-123"')
                name = args[args.index("/TN") + 1]
                if args[0] == "/Query":
                    if self.xml is None:
                        return owner.result(returncode=1)
                    if "/XML" in args:
                        return owner.result(self.xml)
                    stream = io.StringIO()
                    csv.writer(stream).writerow(["synthetic-secret", "\\" + name, "9/24/2026 11:15:00 AM", self.state, "synthetic-secret", "9/24/2026 11:00:00 AM", "0", "synthetic-secret"])
                    return owner.result(stream.getvalue().encode())
                if args[0] == "/Create":
                    if self.create_fails:
                        return owner.result(returncode=1)
                    self.xml = Path(args[args.index("/XML") + 1]).read_bytes()
                elif args[0] == "/Change":
                    task = ET.fromstring(self.xml)
                    task.find("{*}Settings/{*}Enabled").text = "true" if "/Enable" in args else "false"
                    self.xml = ET.tostring(task, encoding="utf-16")
                    self.state = "Ready" if "/Enable" in args else "Disabled"
                elif args[0] == "/Run":
                    self.state = "Running"
                elif args[0] == "/End":
                    self.state = "Disabled"
                else:
                    raise AssertionError("Unexpected command")
                return owner.result()

        return Scheduler()

    def test_configuration_has_same_cadence_and_protected_direct_action(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "workspace with spaces & symbols"
            executable = Path(directory) / "python.exe"
            (Path(directory) / "pythonw.exe").touch()
            with patch.object(service, "ROOT", root), patch.object(service.sys, "executable", str(executable)):
                xml = service.windows_configuration()
        task = ET.fromstring(xml)
        ns = {"t": "http://schemas.microsoft.com/windows/2004/02/mit/task"}

        def value(path):
            return task.find(path, ns).text

        self.assertEqual(value("t:Triggers/t:TimeTrigger/t:Repetition/t:Interval"), "PT15M")
        self.assertIsNone(task.find("t:Triggers/t:TimeTrigger/t:Repetition/t:Duration", ns))
        self.assertEqual(value("t:Triggers/t:LogonTrigger/t:UserId"), "__CURRENT_USER_SID__")
        self.assertEqual(value("t:Principals/t:Principal/t:LogonType"), "InteractiveToken")
        self.assertEqual(value("t:Principals/t:Principal/t:RunLevel"), "LeastPrivilege")
        self.assertEqual(value("t:Settings/t:MultipleInstancesPolicy"), "IgnoreNew")
        self.assertEqual(value("t:Settings/t:ExecutionTimeLimit"), "PT10M")
        self.assertEqual(value("t:Settings/t:StartWhenAvailable"), "true")
        self.assertEqual(value("t:Settings/t:DisallowStartIfOnBatteries"), "false")
        self.assertEqual(value("t:Settings/t:StopIfGoingOnBatteries"), "false")
        self.assertEqual(value("t:Actions/t:Exec/t:Command"), str(executable.with_name("pythonw.exe")))
        self.assertEqual(value("t:Actions/t:Exec/t:Arguments"), subprocess.list2cmdline([str(root / "scripts/local_fallback.py"), "--scheduled"]))
        self.assertEqual(value("t:Actions/t:Exec/t:WorkingDirectory"), str(root))
        for forbidden in ("SERVICE_ROLE_KEY", "UPSTREAM_ACCESS_TOKEN", "Password", "EnvironmentVariables", "--dry-run"):
            self.assertNotIn(forbidden, xml)

    def test_preflight_missing_timezone_data_does_not_register(self):
        with patch.object(service.Path, "is_file", return_value=True), \
                patch.object(service, "ZoneInfo", side_effect=service.ZoneInfoNotFoundError), \
                patch.object(service.subprocess, "run") as run:
            self.assertEqual(service.windows_service("start"), 1)
        run.assert_not_called()
        self.assertIn("tzdata", self.output.getvalue())

    def test_preflight_missing_windowless_interpreter_does_not_register(self):
        with patch.object(service.Path, "is_file", return_value=False), \
                patch.object(service.subprocess, "run") as run:
            self.assertEqual(service.windows_service("install"), 1)
        run.assert_not_called()
        self.assertIn("pythonw.exe", self.output.getvalue())

    def test_native_commands_are_hidden_bounded_and_noninteractive(self):
        with patch.object(service.subprocess, "run", return_value=self.result()) as run:
            service.windows_command("schtasks.exe", "/Query", "/TN", "owned-task", "/XML")
        arguments = run.call_args.args[0]
        self.assertEqual(Path(arguments[0]).name, "schtasks.exe")
        self.assertEqual(arguments[1:], ["/Query", "/TN", "owned-task", "/XML"])
        self.assertEqual(run.call_args.kwargs["timeout"], 30)
        self.assertEqual(run.call_args.kwargs["creationflags"], 0x08000000)
        self.assertEqual(run.call_args.kwargs["stdin"], subprocess.DEVNULL)
        self.assertTrue(run.call_args.kwargs["capture_output"])

    def test_start_creates_task_without_overwriting_and_removes_temporary_xml(self):
        scheduler = self.scheduler(installed=False)
        with tempfile.TemporaryDirectory() as directory, patch.object(service, "STATE", Path(directory)), \
                patch.object(service, "windows_command", side_effect=scheduler), \
                patch.object(service.Path, "is_file", return_value=True):
            self.assertEqual(service.windows_service("start"), 0)
            self.assertEqual(list(Path(directory).iterdir()), [])
        commands = [entry[1] for entry in scheduler.calls if entry[0] == "schtasks.exe"]
        self.assertEqual(commands, ["/Query", "/Create", "/Run", "/Query", "/Query"])
        self.assertTrue(all("/F" not in entry for entry in scheduler.calls))
        self.assertNotIn("__CURRENT_USER_SID__", scheduler.xml.decode("utf-16"))
        self.assertNotIn("synthetic-secret", self.output.getvalue())

    def test_creation_race_does_not_overwrite_or_run_task(self):
        scheduler = self.scheduler(installed=False)
        scheduler.create_fails = True
        with tempfile.TemporaryDirectory() as directory, patch.object(service, "STATE", Path(directory)), \
                patch.object(service, "windows_command", side_effect=scheduler), \
                patch.object(service.Path, "is_file", return_value=True):
            self.assertEqual(service.windows_service("install"), 1)
            self.assertEqual(list(Path(directory).iterdir()), [])
        self.assertNotIn("/Run", [entry[1] for entry in scheduler.calls])
        self.assertTrue(all("/F" not in entry for entry in scheduler.calls))

    def test_start_preserves_existing_running_task_and_schedule(self):
        scheduler = self.scheduler()
        scheduler.state = "Running"
        original_xml = scheduler.xml
        with patch.object(service, "windows_command", side_effect=scheduler), patch.object(service.Path, "is_file", return_value=True):
            self.assertEqual(service.windows_service("start"), 0)
        self.assertEqual(scheduler.xml, original_xml)
        self.assertTrue(all(entry[1] in ("/Query", "/user") for entry in scheduler.calls))

    def test_restart_reenables_existing_task_and_requests_run(self):
        scheduler = self.scheduler(enabled=False)
        with patch.object(service, "windows_command", side_effect=scheduler), patch.object(service.Path, "is_file", return_value=True):
            self.assertEqual(service.windows_service("start"), 0)
        self.assertIn(("schtasks.exe", "/Change", "/TN", service.LABEL + "-S-1-5-21-123", "/Enable"), scheduler.calls)
        self.assertNotIn("/Create", [entry[1] for entry in scheduler.calls])
        self.assertIn("/Run", [entry[1] for entry in scheduler.calls])

    def test_run_does_not_end_active_instance(self):
        scheduler = self.scheduler()
        scheduler.state = "Running"
        with patch.object(service, "windows_command", side_effect=scheduler):
            self.assertEqual(service.windows_service("run"), 0)
        commands = [entry[1] for entry in scheduler.calls]
        self.assertEqual(commands.count("/Run"), 1)
        self.assertNotIn("/End", commands)
        self.assertNotIn("/Change", commands)

    def test_run_disabled_task_requires_start(self):
        scheduler = self.scheduler(enabled=False)
        with patch.object(service, "windows_command", side_effect=scheduler):
            self.assertEqual(service.windows_service("run"), 1)
        self.assertNotIn("/Run", [entry[1] for entry in scheduler.calls])
        self.assertIn("disabled", self.output.getvalue())

    def test_stop_disables_and_ends_only_owned_task(self):
        scheduler = self.scheduler()
        with patch.object(service, "windows_command", side_effect=scheduler):
            self.assertEqual(service.windows_service("stop"), 0)
        mutations = [entry for entry in scheduler.calls if entry[1] in ("/Change", "/End")]
        name = service.LABEL + "-S-1-5-21-123"
        self.assertEqual(mutations, [("schtasks.exe", "/Change", "/TN", name, "/Disable"), ("schtasks.exe", "/End", "/TN", name)])
        self.assertIn("enabled = False", self.output.getvalue())

    def test_changed_task_configuration_cannot_be_run_or_overwritten(self):
        for original, changed in (("IgnoreNew", "Parallel"), ("--scheduled", "synthetic-secret"), ("LeastPrivilege", "HighestAvailable")):
            scheduler = self.scheduler()
            scheduler.xml = scheduler.xml.decode("utf-16").replace(original, changed).encode("utf-16")
            with self.subTest(changed=changed), patch.object(service, "windows_command", side_effect=scheduler):
                self.assertEqual(service.windows_service("run"), 1)
            self.assertTrue(all(entry[1] in ("/Query", "/user") for entry in scheduler.calls))
        self.assertNotIn("synthetic-secret", self.output.getvalue())

    def test_normalized_logon_account_and_default_runlevel_are_accepted(self):
        scheduler = self.scheduler()
        task = ET.fromstring(scheduler.xml)
        task.find("{*}Triggers/{*}LogonTrigger/{*}UserId").text = "SYNTHETIC-SECRET"
        principal = task.find("{*}Principals/{*}Principal")
        principal.remove(principal.find("{*}RunLevel"))
        scheduler.xml = ET.tostring(task, encoding="utf-16")
        with patch.object(service, "windows_command", side_effect=scheduler):
            self.assertEqual(service.windows_service("status"), 0)
        self.assertNotIn("SYNTHETIC-SECRET", self.output.getvalue())

    def test_status_filters_untrusted_fields_and_unknown_task_rows(self):
        name = service.LABEL + "-S-1-5-21-123"
        rows = io.StringIO()
        writer = csv.writer(rows)
        writer.writerow(["host", "other-task", "secret", "Running", "secret", "secret", "123"])
        writer.writerow(["synthetic-secret", "\\" + name, "synthetic-secret", "synthetic-secret", "synthetic-secret", "synthetic-secret", "synthetic-secret"])
        status = {"enabled": True}
        with patch.object(service, "windows_command", return_value=self.result(rows.getvalue().encode())):
            service.windows_status(name, status)
        self.assertEqual(status, {"enabled": True, "state": "unknown"})

    def test_missing_runtime_csv_does_not_prevent_xml_enabled_status(self):
        scheduler = self.scheduler(enabled=False)
        def command(program, *args):
            return self.result(returncode=1) if "/CSV" in args or "CSV" in args else scheduler(program, *args)
        with patch.object(service, "windows_command", side_effect=command):
            self.assertEqual(service.windows_service("status"), 0)
        self.assertIn("enabled = False", self.output.getvalue())

    def test_launch_and_decode_failures_are_safe(self):
        failures = (
            OSError("synthetic-secret"),
            subprocess.TimeoutExpired("synthetic-secret", 30, output="synthetic-secret"),
            self.result(b"synthetic-secret", returncode=1),
            self.result(b"synthetic-secret"),
        )
        for failure in failures:
            kwargs = {"side_effect": failure} if isinstance(failure, Exception) else {"return_value": failure}
            with self.subTest(failure=type(failure).__name__), patch.object(service, "windows_command", **kwargs):
                self.assertEqual(service.windows_service("status"), 1)
        self.assertNotIn("synthetic-secret", self.output.getvalue())

    def test_windows_main_never_calls_launchctl(self):
        for command in ("install", "start", "stop", "run", "status"):
            with self.subTest(command=command), patch.object(service.sys, "argv", ["service", command]), \
                    patch.object(service, "windows_service", return_value=0) as windows, \
                    patch.object(service, "launchctl") as launchctl:
                self.assertEqual(service.main(), 0)
            windows.assert_called_once_with(command)
            launchctl.assert_not_called()

    def test_windows_logs_are_utf8_and_tail_is_bounded(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            (state / "fallback.log").write_text("\n".join(f"line {n} \u2013 safe" for n in range(100)), encoding="utf-8")
            with patch.object(service, "STATE", state), patch.object(service.sys, "argv", ["service", "logs"]), \
                    patch.object(service, "windows_service") as windows:
                self.assertEqual(service.main(), 0)
        windows.assert_not_called()
        lines = self.output.getvalue().splitlines()
        self.assertEqual(len(lines), 80)
        self.assertEqual(lines[0], "line 20 \u2013 safe")
        self.assertEqual(lines[-1], "line 99 \u2013 safe")

    def test_windows_import_does_not_require_getuid(self):
        script = "import os, sys; sys.platform = 'win32'; hasattr(os, 'getuid') and delattr(os, 'getuid'); import local_fallback_service"
        result = subprocess.run([sys.executable, "-c", script], cwd=Path(__file__).resolve().parent, capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)


class MacServiceRegressionTests(unittest.TestCase):
    def test_mac_launchd_configuration_is_unchanged(self):
        self.assertEqual(service.configuration(), {
            "Label": service.LABEL,
            "ProgramArguments": [sys.executable, str(service.ROOT / "scripts/local_fallback.py"), "--scheduled"],
            "WorkingDirectory": str(service.ROOT), "StartInterval": 900, "RunAtLoad": True,
            "ProcessType": "Background", "LowPriorityIO": True, "Umask": 0o077,
            "StandardOutPath": str(service.STATE / "launchd.log"),
            "StandardErrorPath": str(service.STATE / "launchd.log"),
        })

    def test_mac_run_does_not_kill_an_existing_run(self):
        result = SimpleNamespace(returncode=0, stdout="state = running\nsecret = synthetic-secret")
        with patch.object(service.sys, "platform", "darwin"), patch.object(service.sys, "argv", ["service", "run"]), \
                patch.object(service, "launchctl", return_value=result) as launchctl, \
                patch.object(service, "windows_service") as windows, contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(service.main(), 0)
        self.assertEqual(launchctl.call_args_list, [call("kickstart", service.SERVICE)])
        windows.assert_not_called()
        self.assertNotIn("synthetic-secret", output.getvalue())

    def test_mac_stop_keeps_disable_and_bootout_behavior(self):
        with patch.object(service.sys, "platform", "darwin"), patch.object(service.sys, "argv", ["service", "stop"]), \
                patch.object(service, "launchctl", return_value=SimpleNamespace(returncode=0)) as launchctl, \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(service.main(), 0)
        self.assertEqual(launchctl.call_args_list, [call("disable", service.SERVICE), call("bootout", service.SERVICE)])


if __name__ == "__main__":
    unittest.main()
