// The eight-signal recorder. Event-driven where macOS offers a notification (AX focus and window creation, the
// pointer event tap, workspace activation and Space changes, the typist field's value), with a 20 Hz sampler beside
// it for what has no notification (window order, the pasteboard change count) and as a second read of the rest.
// It never acts on the desktop and judges nothing: it reports facts (including the raw AXError of a new window's
// reads and how many such reads were still running at stop), and the reducer in summary.ts judges them. The
// self-test's sabotage lives in that reducer, not here.

import AppKit
import ApplicationServices

private let axCallback: AXObserverCallback = { _, element, notification, refcon in
  guard let refcon else { return }
  Unmanaged<Recorder>.fromOpaque(refcon).takeUnretainedValue().onAccessibility(element, notification as String)
}

private let tapCallback: CGEventTapCallBack = { _, type, event, refcon in
  if let refcon { Unmanaged<Recorder>.fromOpaque(refcon).takeUnretainedValue().onTap(type, event) }
  return Unmanaged.passUnretained(event)
}

final class Recorder: NSObject {
  let userPid: pid_t
  let targetPids: [pid_t]
  let fieldIdentifier: String
  var recording = false
  var observers: [pid_t: AXObserver] = [:]
  var tap: CFMachPort?
  var field: AXUIElement?
  var last: [String: String] = [:]
  var knownWindows: Set<UInt32> = []
  var windowsListed = false
  var pendingReads = 0
  var stopping = false

  init(userPid: pid_t, targetPids: [pid_t], fieldIdentifier: String) {
    self.userPid = userPid
    self.targetPids = targetPids
    self.fieldIdentifier = fieldIdentifier
  }

  var refcon: UnsafeMutableRawPointer { Unmanaged.passUnretained(self).toOpaque() }

  func send(_ signal: String, _ fields: [String: Any]) {
    emit(fields)
  }

  func fault(_ signal: String, _ detail: String) { emit(["kind": "fault", "signal": signal, "detail": detail]) }
  func armed(_ signal: String, _ via: String) { emit(["kind": "armed", "signal": signal, "via": via]) }

  func observe(_ pid: pid_t, _ element: AXUIElement, _ notifications: [String]) -> AXError {
    if observers[pid] == nil {
      var created: AXObserver?
      let error = AXObserverCreate(pid, axCallback, &created)
      guard error == .success, let created else { return error }
      CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(created), .defaultMode)
      observers[pid] = created
    }
    guard let observer = observers[pid] else { return .failure }
    for name in notifications {
      let error = AXObserverAddNotification(observer, element, name as CFString, refcon)
      if error != .success && error != .notificationAlreadyRegistered { return error }
    }
    return .success
  }

  func arm() {
    // Every accessibility read this process makes is capped: a read of an app that is busy (a window being created,
    // an app being activated) otherwise blocks the main thread for seconds and stalls the 20 Hz sampler. Set on the
    // system-wide element, this is the default for every element that does not set its own.
    AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), 0.05)
    emit(["kind": "context", "userPid": Int(userPid), "targetPids": targetPids.map { Int($0) }])
    let user = AXUIElementCreateApplication(userPid)
    let focus = observe(userPid, user, [kAXFocusedUIElementChangedNotification, kAXFocusedWindowChangedNotification])
    if focus == .success { armed("key_focus", "notification+sample") } else { fault("key_focus", "AX observer on the user's app failed (\(focus.rawValue))") }

    if let listed = listWindows() {
      knownWindows = Set(listed.map(\.number))
      windowsListed = true
      armed("window_raised", "sample")
    } else {
      fault("window_raised", "window list unreadable")
    }

    field = axFind(user, identifier: fieldIdentifier)
    if let field, observe(userPid, field, [kAXValueChangedNotification]) == .success {
      armed("typing", "notification+sample")
    } else {
      fault("typing", "typist field \(fieldIdentifier) not found or not observable")
    }

    let mask = [CGEventType.mouseMoved, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged, .leftMouseDown, .rightMouseDown, .otherMouseDown]
      .reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << CGEventMask($1.rawValue)) }
    tap = CGEvent.tapCreate(
      tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly, eventsOfInterest: mask,
      callback: tapCallback, userInfo: refcon)
    if let tap, let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0) {
      CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
      CGEvent.tapEnable(tap: tap, enable: true)
      armed("pointer", "tap+sample")
    } else {
      fault("pointer", "listen-only event tap could not be created")
    }

    armed("clipboard", "sample")

    let center = NSWorkspace.shared.notificationCenter
    center.addObserver(self, selector: #selector(spaceChanged), name: NSWorkspace.activeSpaceDidChangeNotification, object: nil)
    if activeSpaceId() != nil { armed("space", "notification+sample") } else { fault("space", "active Space id unreadable") }

    center.addObserver(self, selector: #selector(activated(_:)), name: NSWorkspace.didActivateApplicationNotification, object: nil)
    armed("activation", "notification+sample")

    center.addObserver(self, selector: #selector(launched(_:)), name: NSWorkspace.didLaunchApplicationNotification, object: nil)
    for app in NSWorkspace.shared.runningApplications where app.processIdentifier != getpid() {
      watchWindows(of: app.processIdentifier)
    }
    if windowsListed { armed("dialog", "notification+sample") } else { fault("dialog", "window list unreadable") }
  }

  // A just-launched app with a user interface often refuses registration until its AX server is up, so only such an
  // app is retried, for up to 2 s; a background agent is tried once and never costs the main thread a retry round.
  // Every gap is reported with the moment it began (`since`): a registration that came late as observer_late, one
  // that never came as observer_failed. The reducer judges the gap's overlap with the recording, and does not judge
  // the target's own apps or apps without a UI. An app that has quit is not reported.
  func watchWindows(of pid: pid_t, attempt: Int = 1, since: Double = uptimeMs()) {
    let error = observe(pid, AXUIElementCreateApplication(pid), [kAXWindowCreatedNotification, kAXSheetCreatedNotification])
    guard let app = NSRunningApplication(processIdentifier: pid), !app.isTerminated else { return }
    let regular = app.activationPolicy == .regular
    if error == .success {
      if attempt > 1 {
        emit(["kind": "observer_late", "pid": Int(pid), "attempts": attempt, "regular": regular, "since": since])
      }
      return
    }
    if regular && attempt < 10 { return after(0.2) { self.watchWindows(of: pid, attempt: attempt + 1, since: since) } }
    emit([
      "kind": "observer_failed", "pid": Int(pid), "axError": axErrorName(error), "attempts": attempt,
      "regular": regular, "since": since,
    ])
  }

  @objc func spaceChanged() {
    send("space", ["kind": "space", "via": "notification", "value": activeSpaceId().map { String($0) } ?? "unknown"])
  }

  @objc func activated(_ note: Notification) {
    let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
    send("activation", ["kind": "activation", "via": "notification", "pid": Int(app?.processIdentifier ?? -1)])
  }

  @objc func launched(_ note: Notification) {
    if let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication {
      watchWindows(of: app.processIdentifier)
    }
  }

  func onAccessibility(_ element: AXUIElement, _ notification: String) {
    switch notification {
    case kAXFocusedUIElementChangedNotification, kAXFocusedWindowChangedNotification:
      send("key_focus", ["kind": "focus", "via": "notification", "value": focusIdentity(of: userPid) ?? "unreadable"])
    case kAXValueChangedNotification:
      if let text = fieldText(), text != Recorder.busy { send("typing", ["kind": "field", "text": text, "final": false]) }
    case kAXWindowCreatedNotification, kAXSheetCreatedNotification:
      windowAdded(element, sheet: notification == kAXSheetCreatedNotification)
    default:
      break
    }
  }

  // A window-created notification arrives while its owner is still building the window, so its reads can time out.
  // They run off the main thread with a bounded retry of a timed-out read; the raw AXError name, the number of read
  // attempts and which notification fired go into the event, and the reducer judges them. `pendingReads` lets `stop` wait for reads still running instead of closing the window on
  // them (the retry can take ~3 s: 20 x (2 x 50 ms timeouts + 50 ms)).
  func windowAdded(_ element: AXUIElement, sheet: Bool) {
    let at = uptimeMs()
    pendingReads += 1
    DispatchQueue.global(qos: .userInitiated).async {
      AXUIElementSetMessagingTimeout(element, 0.05)
      var pid: pid_t = 0
      AXUIElementGetPid(element, &pid)
      var role = "", subrole = "", lastError = AXError.success, reads = 0
      for _ in 0..<20 {
        reads += 1
        let (roleError, roleValue) = axValue(element, kAXRoleAttribute)
        let (subroleError, subroleValue) = axValue(element, kAXSubroleAttribute)
        role = roleValue as? String ?? ""
        subrole = subroleValue as? String ?? ""
        lastError = roleError != .success ? roleError : subroleError
        if roleError != .cannotComplete && subroleError != .cannotComplete { break }
        usleep(50_000)
      }
      var number: CGWindowID = 0
      if let windowOfElement { _ = windowOfElement(element, &number) }
      let layer = listWindows()?.first { $0.number == number }?.layer ?? 0
      DispatchQueue.main.async {
        self.pendingReads -= 1
        if number != 0 { self.knownWindows.insert(number) }
        self.send("dialog", [
          "t": at, "kind": "window_added", "source": "ax", "notification": sheet ? "sheet" : "window",
          "id": "ax:\(pid)#\(number)", "ownerPid": Int(pid), "layer": layer,
          "role": role, "subrole": subrole, "axError": axErrorName(lastError), "axReads": reads,
        ])
      }
    }
  }

  // `stop <ms>` waits up to that long for new-window reads still running, then reports how many were left; `final`
  // waits for it. The harness sends both budgets and waits at least that long for each marker.
  func drainThenStop(deadline: Double) {
    if pendingReads > 0 && uptimeMs() < deadline { return after(0.05) { self.drainThenStop(deadline: deadline) } }
    recording = false
    emit(["kind": "stop", "pendingReads": pendingReads])
    stopping = false
  }

  func onTap(_ type: CGEventType, _ event: CGEvent) {
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
      if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
      fault("pointer", "event tap was disabled by the system (\(type.rawValue)) and may have missed events")
      return
    }
    send("pointer", ["kind": "pointer", "via": "tap", "x": event.location.x, "y": event.location.y])
  }

  // The final field read is the typing verdict, so a read that only timed out (the app was busy) is retried for up to
  // the harness's budget; a read that failed outright, or still times out at the deadline, is a fault.
  func finalRead(deadline: Double) {
    let text = fieldText()
    if let text, text != Recorder.busy { return emit(["kind": "field", "text": text, "final": true]) }
    if text == Recorder.busy, uptimeMs() < deadline { return after(0.05) { self.finalRead(deadline: deadline) } }
    fault("typing", text == nil ? "final field read failed" : "final field read timed out")
  }

  func budget(_ words: [String], _ fallback: Double) -> Double { words.dropFirst().first.flatMap { Double($0) } ?? fallback }

  func command(_ words: [String]) {
    switch words.first {
    case "start":
      emit(["kind": "start"])
      recording = true
    case "stop":
      stopping = true
      drainThenStop(deadline: uptimeMs() + budget(words, 4_000))
    case "final":
      if stopping { return after(0.05) { self.command(words) } }
      finalRead(deadline: uptimeMs() + budget(words, 1_000))
    case "snapshot":
      emitSnapshot()
    case "quit":
      exit(0)
    default:
      emit(["ctl": "error", "detail": "unknown command \(words.joined(separator: " "))"])
    }
  }
}

@main
enum RecorderMain {
  static func main() {
    guard let user = argument("--user-pid").flatMap({ pid_t($0) }) else {
      FileHandle.standardError.write(Data("usage: recorder --user-pid <pid> [--target-pid <pid>,...] [--field <id>]\n".utf8))
      exit(2)
    }
    let targets = (argument("--target-pid") ?? "").split(separator: ",").compactMap { pid_t($0) }
    let app = NSApplication.shared
    app.setActivationPolicy(.prohibited)
    let recorder = Recorder(
      userPid: user, targetPids: targets, fieldIdentifier: argument("--field") ?? "sentinel.field")
    emit(["ctl": "hello", "role": "recorder", "pid": Int(getpid()), "trusted": AXIsProcessTrusted()])
    recorder.arm()
    recorder.startSampler()
    readCommands { recorder.command($0) }
    emit(["ctl": "ready", "role": "recorder"])
    app.run()
  }
}
