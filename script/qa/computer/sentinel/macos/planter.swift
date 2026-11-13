// The self-test's source of disturbances. Each command plants exactly one of the eight disturbances once, holds it
// for a moment, and restores it before the typist's next keystroke, so "happened" is proven even when the desktop
// looks untouched afterwards. `--idle` runs a windowless regular app that only exists to be activated.

import AppKit
import ApplicationServices

final class Planter: NSObject {
  let background = NSWindow(
    contentRect: NSRect(x: 260, y: 380, width: 420, height: 260), styleMask: [.titled], backing: .buffered, defer: false)
  let source = CGEventSource(stateID: .hidSystemState)
  var alert: NSPanel?

  func setUp() {
    background.title = "Sentinel Background"
    background.collectionBehavior = [.canJoinAllSpaces]
    background.orderFrontRegardless()
    emit(["ctl": "hello", "role": "planter", "pid": Int(getpid()), "window": background.windowNumber, "trusted": AXIsProcessTrusted()])
  }

  func planted(_ plant: String, at: Double = uptimeMs()) { emit(["ctl": "planted", "plant": plant, "t": at]) }
  func restored(_ plant: String) { emit(["ctl": "restored", "plant": plant]) }
  func failed(_ plant: String, _ detail: String) { emit(["ctl": "plant_failed", "plant": plant, "detail": detail]) }

  func postMove(to point: CGPoint) {
    CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)?
      .post(tap: .cghidEventTap)
  }

  // A system hotkey (Control-Arrow switches Spaces) is matched on real modifier key events, so the Control key itself
  // goes down before the arrow and up after it, as a keyboard would send them.
  func postControlChord(_ code: CGKeyCode) {
    let control: CGKeyCode = 59
    let arrow: CGEventFlags = [.maskControl, .maskNumericPad, .maskSecondaryFn]
    let sequence: [(CGKeyCode, Bool, CGEventFlags)] = [
      (control, true, .maskControl), (code, true, arrow), (code, false, arrow), (control, false, []),
    ]
    for (key, down, flags) in sequence {
      let event = CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: down)
      event?.flags = flags
      event?.post(tap: .cghidEventTap)
    }
  }

  // Polls the active Space every 50 ms until it differs from `from` or the deadline passes; a switch that lands late is
  // still reported (and so still restored) instead of leaving the desktop on another Space.
  func waitForSpaceChange(from: UInt64, deadline: Double, _ done: @escaping (Bool) -> Void) {
    if let now = activeSpaceId(), now != from { return done(true) }
    if uptimeMs() >= deadline { return done(false) }
    after(0.05) { self.waitForSpaceChange(from: from, deadline: deadline, done) }
  }

  func setFocus(pid: pid_t, identifier: String) -> Bool {
    guard let element = axFind(AXUIElementCreateApplication(pid), identifier: identifier) else { return false }
    return AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue) == .success
  }

  func command(_ words: [String]) {
    let numbers = words.dropFirst().compactMap { Int32($0) }
    switch words.first {
    case "raise":
      guard let typistWindow = numbers.first else { return failed("window_raised", "usage: raise <typist window>") }
      background.orderFrontRegardless()
      planted("window_raised")
      after(0.3) {
        self.background.order(.below, relativeTo: Int(typistWindow))
        self.restored("window_raised")
      }
    case "hover-top":
      if let screen = NSScreen.screens.first {
        postMove(to: CGPoint(x: screen.frame.midX, y: 40))
        postMove(to: CGPoint(x: screen.frame.midX, y: 1))
      }
      emit(["ctl": "hovered"])
    case "pointer", "warp":
      let plant = words.first == "warp" ? "warp" : "pointer"
      guard let start = pointerLocation() else { return failed(plant, "cursor position unreadable") }
      let away = CGPoint(x: start.x + 50, y: start.y)
      if plant == "warp" { CGWarpMouseCursorPosition(away) } else { postMove(to: away) }
      planted(plant)
      after(plant == "warp" ? 0.15 : 0.3) {
        if plant == "warp" { CGWarpMouseCursorPosition(start) } else { self.postMove(to: start) }
        self.restored(plant)
      }
    case "pasteboard":
      let board = NSPasteboard.general
      let prior = board.string(forType: .string)
      board.clearContents()
      board.setString("sentinel-plant", forType: .string)
      planted("clipboard")
      after(0.3) {
        board.clearContents()
        if let prior { board.setString(prior, forType: .string) }
        self.restored("clipboard")
      }
    case "space":
      guard let before = activeSpaceId() else { return failed("space", "active Space id unreadable") }
      guard (managedSpaceCount() ?? 0) >= 2 else { return failed("space", "fewer than two Spaces exist") }
      let postedAt = uptimeMs()
      postControlChord(124)
      waitForSpaceChange(from: before, deadline: uptimeMs() + 2_000) { switched in
        guard switched else { return self.failed("space", "Control-Right did not change the active Space within 2 s") }
        self.planted("space", at: postedAt)
        self.postControlChord(123)
        self.waitForSpaceChange(from: activeSpaceId() ?? before, deadline: uptimeMs() + 2_000) { _ in
          self.restored("space")
        }
      }
    case "alert":
      let panel = NSPanel(
        contentRect: NSRect(x: 320, y: 300, width: 300, height: 120), styleMask: [.titled], backing: .buffered, defer: false)
      panel.title = "Sentinel Alert"
      panel.level = .modalPanel
      panel.orderFrontRegardless()
      alert = panel
      planted("dialog")
      after(0.3) {
        self.alert?.close()
        self.alert = nil
        self.restored("dialog")
      }
    case "sheet":
      // AX-only dialog: a sheet on this app's own background window sits at window layer 0, so the window list cannot
      // see it as a dialog. The main thread blocks 200 ms now and again after one run-loop turn (whichever moment the
      // sheet-created notification goes out), so the recorder's first AX reads of the sheet time out. The self-test
      // requires the role read to succeed after at least one retry; if a host never makes it retry, that trial fails
      // and says so instead of claiming the retry was exercised.
      let sheet = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 240, height: 90), styleMask: [.titled], backing: .buffered, defer: false)
      background.beginSheet(sheet)
      planted("sheet")
      usleep(200_000)
      DispatchQueue.main.async { usleep(200_000) }
      after(0.6) {
        self.background.endSheet(sheet)
        sheet.orderOut(nil)
        self.restored("sheet")
      }
    case "focus":
      guard let typist = numbers.first else { return failed("key_focus", "usage: focus <typist pid>") }
      guard setFocus(pid: typist, identifier: "sentinel.other") else { return failed("key_focus", "could not focus sentinel.other") }
      planted("key_focus")
      after(0.3) {
        _ = self.setFocus(pid: typist, identifier: "sentinel.field")
        self.restored("key_focus")
      }
    case "spaces":
      emit(["ctl": "spaces", "count": managedSpaceCount() ?? -1])
    case "quit":
      exit(0)
    default:
      emit(["ctl": "error", "detail": "unknown command \(words.joined(separator: " "))"])
    }
  }
}

// The idle app reports the moment it becomes active, whoever activated it (the self-test activates it through
// LaunchServices, as a person's click would), then yields the front back to the typist.
final class IdleApp: NSObject {
  var typistPid: pid_t?

  func command(_ words: [String]) {
    switch words.first {
    case "arm":
      typistPid = words.dropFirst().first.flatMap { pid_t($0) }
      emit(["ctl": "armed", "role": "idle"])
    case "quit":
      exit(0)
    default:
      emit(["ctl": "error", "detail": "idle: unknown command \(words.joined(separator: " "))"])
    }
  }

  @objc func becameActive() {
    guard let typistPid else { return }
    emit(["ctl": "planted", "plant": "activation"])
    after(0.3) {
      if #available(macOS 14.0, *), let typist = NSRunningApplication(processIdentifier: typistPid) {
        NSApp.yieldActivation(to: typist)
      }
      emit(["ctl": "restoring", "plant": "activation"])
    }
  }
}

@main
enum PlanterMain {
  static func main() {
    let app = NSApplication.shared
    if CommandLine.arguments.contains("--idle") {
      app.setActivationPolicy(.regular)
      let idle = IdleApp()
      NotificationCenter.default.addObserver(
        idle, selector: #selector(IdleApp.becameActive), name: NSApplication.didBecomeActiveNotification, object: nil)
      readCommands { idle.command($0) }
      DispatchQueue.main.async { emit(["ctl": "hello", "role": "idle", "pid": Int(getpid())]) }
    } else {
      app.setActivationPolicy(.accessory)
      let planter = Planter()
      readCommands { planter.command($0) }
      DispatchQueue.main.async { planter.setUp() }
    }
    app.run()
  }
}
