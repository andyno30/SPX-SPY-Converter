// Own only the application instance launched here; never hide or kill by name.
import AppKit
import CoreGraphics
import Foundation
import Darwin

guard CommandLine.arguments.count == 3, CommandLine.arguments[1] == "--worker" else { exit(64) }
let directory = URL(fileURLWithPath: CommandLine.arguments[2])
let config = try JSONSerialization.jsonObject(with: Data(contentsOf: directory.appendingPathComponent("launch.json"))) as! [String: Any]
let workerPID = pid_t(config["worker_pid"] as! Int)
let ownerPID = pid_t(config["owner_pid"] as! Int)
let watchdog = config["watchdog_seconds"] as! Double
var browser: NSRunningApplication?
var launchCompleted = false
var activatedPIDs: Set<pid_t> = []
let started = Date()
var stopping: Date?
var stopReason = ""
var forced = false
var hideRequested = false
var activationCount = 0
var spacesCount = 0
var maxVisible = 0

func emit(_ value: [String: Any], to url: URL) {
    if let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) {
        try? data.write(to: url, options: .atomic)
    }
}
func beginStop(_ reason: String) {
    if stopping != nil { return }
    stopping = Date(); stopReason = reason
    if let app = browser, !app.isTerminated { _ = app.terminate() }
}
func desktopFailure(_ reason: String) {
    FileManager.default.createFile(atPath: directory.appendingPathComponent("focus-failure").path, contents: nil)
    _ = browser?.hide()
    beginStop(reason)
}
let center = NSWorkspace.shared.notificationCenter
let activated = center.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { notification in
    if let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication {
        activatedPIDs.insert(app.processIdentifier)
        if app.processIdentifier == browser?.processIdentifier {
            activationCount += 1; desktopFailure("focus_failure")
        }
    }
}
let spaces = center.addObserver(forName: NSWorkspace.activeSpaceDidChangeNotification, object: nil, queue: .main) { _ in
    // macOS cannot attribute a Space change to its initiator. Conservatively
    // abandon this fetch, including when the user changed Spaces themselves.
    spacesCount += 1; desktopFailure("space_change")
}
let options = NSWorkspace.OpenConfiguration()
options.activates = false; options.hides = true; options.hidesOthers = false
options.createsNewApplicationInstance = true; options.addsToRecentItems = false
options.promptsUserIfNeeded = false; options.arguments = config["arguments"] as! [String]
NSWorkspace.shared.openApplication(at: URL(fileURLWithPath: config["app"] as! String), configuration: options) { app, error in
    browser = app
    launchCompleted = true
    emit(["pid": Int(app?.processIdentifier ?? 0), "launch_ok": app != nil], to: directory.appendingPathComponent("launched.json"))
    if app == nil { beginStop("launch_failure") }
    else if activatedPIDs.contains(app!.processIdentifier) {
        activationCount += 1; desktopFailure("focus_failure")
    }
    // A stop can arrive while LaunchServices is still starting the app.
    if stopping != nil { _ = app?.terminate() }
}
let timer = Timer.scheduledTimer(withTimeInterval: 0.02, repeats: true) { _ in
    let front = NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0
    let windows = (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]) ?? []
    let own = windows.filter {
        ($0[kCGWindowLayer as String] as? Int) == 0 &&
        ($0[kCGWindowOwnerPID as String] as? Int) == Int(browser?.processIdentifier ?? -1)
    }
    maxVisible = max(maxVisible, own.count)
    if !own.isEmpty { desktopFailure("visible_window") }
    if front == browser?.processIdentifier { desktopFailure("focus_failure") }
    if !hideRequested && FileManager.default.fileExists(atPath: directory.appendingPathComponent("hide").path) {
        if !(browser?.isHidden ?? false) { _ = browser?.hide() }
        hideRequested = true
    }
    if FileManager.default.fileExists(atPath: directory.appendingPathComponent("stop").path) { beginStop("requested_cleanup") }
    if kill(workerPID, 0) != 0 { beginStop("worker_exited") }
    if kill(ownerPID, 0) != 0 { beginStop("owner_exited") }
    if Date().timeIntervalSince(started) > watchdog { beginStop("watchdog_timeout") }
    if let stopTime = stopping, Date().timeIntervalSince(stopTime) > 1.0, let app = browser, !app.isTerminated {
        forced = true; _ = app.forceTerminate()
    }
}
while Date().timeIntervalSince(started) < watchdog + 8 {
    RunLoop.current.run(until: Date().addingTimeInterval(0.025))
    if let stopTime = stopping, launchCompleted, Date().timeIntervalSince(stopTime) > 0.35,
       browser == nil || browser!.isTerminated { break }
}
timer.invalidate(); center.removeObserver(activated); center.removeObserver(spaces)
let terminated = launchCompleted && (browser?.isTerminated ?? true)
if terminated {
    // Renderer shutdown can briefly race profile removal after forceTerminate.
    // Wait only for our disposable profile; never touch another browser's files.
    for _ in 0..<50 {
        try? FileManager.default.removeItem(at: directory.appendingPathComponent("profile"))
        if !FileManager.default.fileExists(atPath: directory.appendingPathComponent("profile").path) { break }
        usleep(20_000)
    }
}
let report: [String: Any] = ["browser_pid": Int(browser?.processIdentifier ?? 0),
    "browser_activation_events": activationCount, "space_change_events": spacesCount,
    "maximum_visible_windows": maxVisible, "browser_terminated": terminated,
    "profile_removed": !FileManager.default.fileExists(atPath: directory.appendingPathComponent("profile").path),
    "forced_cleanup": forced, "stop_reason": stopReason,
    "completed_at": ISO8601DateFormatter().string(from: Date())]
emit(report, to: directory.appendingPathComponent("monitor.json"))
emit(report, to: URL(fileURLWithPath: config["report"] as! String))
if terminated && kill(workerPID, 0) != 0 { try? FileManager.default.removeItem(at: directory) }
exit(terminated ? 0 : 1)
