// The recorder's 20 Hz sampler. Each read is emitted when its value differs from the previous read, and the first
// read of each is the baseline. A read that fails is a fault, never a silent "unchanged".

import AppKit
import ApplicationServices

extension Recorder {
  func startSampler() {
    let timer = Timer(timeInterval: 0.05, repeats: true) { [weak self] _ in self?.sample() }
    RunLoop.main.add(timer, forMode: .common)
    sample()
  }

  func changed(_ key: String, _ value: String) -> Bool {
    defer { last[key] = value }
    return last[key] != value
  }

  func focusIdentity(of pid: pid_t) -> String? {
    let (error, value) = axValue(AXUIElementCreateApplication(pid), kAXFocusedUIElementAttribute)
    if error == .noValue { return "none" }
    guard error == .success, let value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return axIdentity(unsafeBitCast(value, to: AXUIElement.self))
  }

  func fieldText() -> String? {
    guard let field else { return nil }
    return axString(field, kAXValueAttribute)
  }

  func sample() {
    emit(["kind": "tick"])

    if let focus = focusIdentity(of: userPid) {
      if changed("focus", focus) { send("key_focus", ["kind": "focus", "via": "sample", "value": focus]) }
    } else {
      fault("key_focus", "focused element read failed")
    }

    if let windows = listWindows() {
      let order = windows.filter { $0.layer == 0 }.map(\.id)
      if changed("order", order.joined(separator: "\n")) { send("window_raised", ["kind": "order", "windows": order]) }
      for window in windows where !knownWindows.contains(window.number) {
        knownWindows.insert(window.number)
        send("dialog", [
          "kind": "window_added", "id": window.id, "ownerPid": Int(window.ownerPid), "layer": window.layer,
          "role": "", "subrole": "",
        ])
      }
    } else {
      fault("window_raised", "window list read failed")
    }

    if field != nil {
      if let text = fieldText() {
        if changed("field", text) { send("typing", ["kind": "field", "text": text, "final": false]) }
      } else {
        fault("typing", "field read failed")
      }
    }

    if let point = pointerLocation() {
      if changed("pointer", "\(point.x),\(point.y)") {
        send("pointer", ["kind": "pointer", "via": "sample", "x": point.x, "y": point.y])
      }
    } else {
      fault("pointer", "cursor position read failed")
    }

    let count = NSPasteboard.general.changeCount
    if changed("clipboard", String(count)) { send("clipboard", ["kind": "clipboard", "changeCount": count]) }

    if let space = activeSpaceId() {
      if changed("space", String(space)) { send("space", ["kind": "space", "via": "sample", "value": String(space)]) }
    }

    if let front = NSWorkspace.shared.frontmostApplication?.processIdentifier {
      if changed("front", String(front)) { send("activation", ["kind": "activation", "via": "sample", "pid": Int(front)]) }
    } else {
      fault("activation", "frontmost application unreadable")
    }
  }

  func emitSnapshot() {
    let front = NSWorkspace.shared.frontmostApplication?.processIdentifier ?? -1
    let point = pointerLocation() ?? .zero
    emit([
      "ctl": "snapshot", "frontmostPid": Int(front), "focused": focusIdentity(of: front) ?? "unreadable",
      "order": listWindows()?.filter { $0.layer == 0 }.map(\.id) ?? [], "pointer": ["x": point.x, "y": point.y],
    ])
  }
}
