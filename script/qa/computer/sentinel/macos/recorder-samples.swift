// The recorder's 20 Hz sampler. Each read is emitted when its value differs from the previous read, and the first
// read of each is the baseline. A read that fails is a fault, never a silent "unchanged".

import AppKit
import ApplicationServices

// The pasteboard change count is read on its own queue, off the sampler's main thread: a read waits on the pasteboard
// server, which can take hundreds of ms while another process writes the pasteboard, and must not stall the sampler.
// The count only grows, so a slow read delays a change but cannot hide one.
final class PasteboardPoller {
  private let queue = DispatchQueue(label: "dev.omo.qa.sentinel.pasteboard")
  private let timer: DispatchSourceTimer
  private var last: Int?

  init() {
    timer = DispatchSource.makeTimerSource(queue: queue)
    timer.schedule(deadline: .now(), repeating: .milliseconds(50), leeway: .milliseconds(5))
    timer.setEventHandler { [unowned self] in self.read() }
  }

  func start() { timer.resume() }

  private func read() {
    let count = NSPasteboard.general.changeCount
    if count != last {
      last = count
      emit(["kind": "clipboard", "changeCount": count])
    }
  }
}

// A sample slower than this reports its slowest read, so a stalled sampler names what held it.
private let slowTickMs = 100.0

extension Recorder {
  func startSampler() {
    pasteboard.start()
    let timer = Timer(timeInterval: 0.05, repeats: true) { [weak self] _ in self?.sample() }
    RunLoop.main.add(timer, forMode: .common)
    sample()
  }

  func changed(_ key: String, _ value: String) -> Bool {
    defer { last[key] = value }
    return last[key] != value
  }

  // A read of an app that is busy (being activated, for one) can block the caller for seconds and stall the 20 Hz
  // sampler. Reads time out after 50 ms; a timed-out sample is skipped and retried on the next tick, while the
  // notification path keeps watching the signal. Any other failed read is a fault.
  func focusIdentity(of pid: pid_t) -> String? {
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 0.05)
    let (error, value) = axValue(app, kAXFocusedUIElementAttribute)
    if error == .noValue { return "none" }
    if error == .cannotComplete { return Recorder.busy }
    guard error == .success, let value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return axIdentity(unsafeBitCast(value, to: AXUIElement.self))
  }

  static let busy = "\u{0}busy"

  func fieldText() -> String? {
    guard let field else { return nil }
    AXUIElementSetMessagingTimeout(field, 0.05)
    let (error, value) = axValue(field, kAXValueAttribute)
    if error == .cannotComplete { return Recorder.busy }
    return value as? String
  }

  func sample() {
    let began = uptimeMs()
    emit(["kind": "tick", "t": began])
    var mark = began
    var slowest = (read: "none", ms: 0.0)
    func timed(_ read: String) {
      let now = uptimeMs()
      if now - mark > slowest.ms { slowest = (read, now - mark) }
      mark = now
    }

    if let focus = focusIdentity(of: userPid) {
      if focus != Recorder.busy, changed("focus", focus) { send("key_focus", ["kind": "focus", "via": "sample", "value": focus]) }
    } else {
      fault("key_focus", "focused element read failed")
    }
    timed("focus")

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
    timed("window list")

    if field != nil {
      if let text = fieldText() {
        if text != Recorder.busy, changed("field", text) { send("typing", ["kind": "field", "text": text, "final": false]) }
      } else {
        fault("typing", "field read failed")
      }
    }
    timed("typist field")

    if let point = pointerLocation() {
      if changed("pointer", "\(point.x),\(point.y)") {
        send("pointer", ["kind": "pointer", "via": "sample", "x": point.x, "y": point.y])
      }
    } else {
      fault("pointer", "cursor position read failed")
    }
    timed("pointer")

    if let space = activeSpaceId() {
      if changed("space", String(space)) { send("space", ["kind": "space", "via": "sample", "value": String(space)]) }
    }
    timed("space")

    if let front = NSWorkspace.shared.frontmostApplication?.processIdentifier {
      if changed("front", String(front)) { send("activation", ["kind": "activation", "via": "sample", "pid": Int(front)]) }
    } else {
      fault("activation", "frontmost application unreadable")
    }
    timed("frontmost app")

    let total = uptimeMs() - began
    if total > slowTickMs {
      emit(["kind": "slow_tick", "ms": total.rounded(), "read": slowest.read, "readMs": slowest.ms.rounded()])
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
