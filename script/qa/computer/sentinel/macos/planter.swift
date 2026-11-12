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

  func postKey(_ code: CGKeyCode, flags: CGEventFlags) {
    for down in [true, false] {
      let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down)
      event?.flags = flags
      event?.post(tap: .cghidEventTap)
    }
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
      if let screen = NSScreen.screens.first { CGWarpMouseCursorPosition(CGPoint(x: screen.frame.midX, y: 1)) }
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
      postKey(124, flags: .maskControl)
      after(0.45) {
        guard activeSpaceId() != before else { return self.failed("space", "Control-Right did not change the active Space") }
        self.planted("space", at: postedAt)
        self.postKey(123, flags: .maskControl)
        self.restored("space")
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

// macOS 14+ activation is cooperative: the frontmost typist has already yielded to this app, which now activates,
// holds the front for a moment, and yields back so the typist can take it again.
func activateThenYield(to typistPid: pid_t?) {
  guard #available(macOS 14.0, *), let typistPid, let typist = NSRunningApplication(processIdentifier: typistPid) else {
    return emit(["ctl": "plant_failed", "plant": "activation", "detail": "needs macOS 14 cooperative activation and a typist pid"])
  }
  let at = uptimeMs()
  NSApp.activate()
  after(0.15) {
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == getpid() else {
      return emit(["ctl": "plant_failed", "plant": "activation", "detail": "the idle app did not become frontmost"])
    }
    emit(["ctl": "planted", "plant": "activation", "t": at])
    after(0.3) {
      NSApp.yieldActivation(to: typist)
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
      readCommands { words in
        switch words.first {
        case "activate":
          activateThenYield(to: words.dropFirst().first.flatMap { pid_t($0) })
        case "quit":
          exit(0)
        default:
          emit(["ctl": "error", "detail": "idle: unknown command \(words.joined(separator: " "))"])
        }
      }
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
