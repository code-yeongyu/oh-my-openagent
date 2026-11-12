// Helper for script/qa/computer/probes/hosted-macos-live.ts, compiled on the runner by swiftc.
// Every command prints one JSON object on stdout; the TypeScript driver grades it.

import AppKit
import ApplicationServices
import CoreGraphics
import Darwin
import Foundation

let arguments = CommandLine.arguments
guard arguments.count >= 2 else { fail("usage: omo-probe <command> [args]") }
let command = arguments[1]

func argument(_ index: Int) -> String {
  guard arguments.count > index else { fail("\(command): missing argument \(index - 1)") }
  return arguments[index]
}

func pidArgument(_ index: Int) -> pid_t {
  guard let value = pid_t(argument(index)) else { fail("\(command): not a pid: \(argument(index))") }
  return value
}

switch command {
case "trusted":
  emit(permissions())
case "ax-tree":
  emit(axTree(pidArgument(2)))
case "ax-checkbox":
  let app = AXUIElementCreateApplication(pidArgument(2))
  guard let box = firstElement(app, role: kAXCheckBoxRole) else { emit(["found": false]) }
  emit([
    "found": true, "value": (axValue(box, kAXValueAttribute) as? NSNumber)?.intValue ?? -1,
    "frame": axFrame(box) ?? NSNull(),
  ])
case "ax-press":
  let app = AXUIElementCreateApplication(pidArgument(2))
  guard let box = firstElement(app, role: kAXCheckBoxRole) else { emit(["found": false]) }
  emit(["found": true, "axError": Int(AXUIElementPerformAction(box, kAXPressAction as CFString).rawValue)])
case "fixture":
  let delegate = Fixture(stateFile: argument(2), readyFile: argument(3), eventFile: argument(4))
  let app = NSApplication.shared
  app.setActivationPolicy(.regular)
  app.delegate = delegate
  app.run()
case "click":
  let before = CGEvent(source: nil)?.location ?? .zero
  let point = CGPoint(x: Double(argument(4)) ?? 0, y: Double(argument(5)) ?? 0)
  let route = arguments.count > 6 ? argument(6) : "cg"
  postMouse(pid: pidArgument(2), windowNumber: Int64(argument(3)) ?? 0, at: point, route: route)
  let after = CGEvent(source: nil)?.location ?? .zero
  emit([
    "posted": true, "route": route, "aim": [point.x, point.y], "pointerBefore": [before.x, before.y], "pointerAfter": [after.x, after.y],
    "postEventPreflight": CGPreflightPostEventAccess(), "axTrusted": AXIsProcessTrusted(),
  ])
case "capture":
  emit(capture(pidArgument(2)))
case "tap-create":
  let tap = createListenTap(passThrough)
  if let tap { CFMachPortInvalidate(tap) }
  emit(["created": tap != nil, "listenEventPreflight": CGPreflightListenEventAccess()])
case "tap-watch":
  Watch.keycode = Int64(argument(2)) ?? 80
  let seconds = Double(argument(3)) ?? 10
  guard let tap = createListenTap(watchCallback) else {
    FileManager.default.createFile(atPath: argument(4), contents: Data("no-tap".utf8))
    emit(["created": false, "events": []])
  }
  CFRunLoopAddSource(CFRunLoopGetMain(), CFMachPortCreateRunLoopSource(nil, tap, 0), .defaultMode)
  CGEvent.tapEnable(tap: tap, enable: true)
  FileManager.default.createFile(atPath: argument(4), contents: Data("ready".utf8))
  CFRunLoopRunInMode(.defaultMode, seconds, false)
  CFMachPortInvalidate(tap)
  emit(["created": true, "events": Watch.events])
case "post-key":
  let keycode = CGKeyCode(argument(2)) ?? 80
  let tag = Int64(argument(3)) ?? 0
  let source = CGEventSource(stateID: .hidSystemState)
  for down in [true, false] {
    guard let event = CGEvent(keyboardEventSource: source, virtualKey: keycode, keyDown: down) else {
      fail("post-key: CGEvent creation failed")
    }
    if tag != 0 { event.setIntegerValueField(.eventSourceUserData, value: tag) }
    event.post(tap: .cghidEventTap)
  }
  emit(["posted": true, "tag": tag, "postEventPreflight": CGPreflightPostEventAccess()])
case "dialogs":
  let owners = Set(arguments.dropFirst(2))
  let list = (CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]]) ?? []
  let found = list.compactMap { $0[kCGWindowOwnerName as String] as? String }.filter { owners.contains($0) }
  emit(["windows": found])
case "ax-hit":
  emit(axHit(x: Double(argument(2)) ?? 0, y: Double(argument(3)) ?? 0))
case "frontmost":
  let front = NSWorkspace.shared.frontmostApplication
  emit(["frontmost": front?.processIdentifier == pidArgument(2), "frontPid": Int(front?.processIdentifier ?? -1)])
case "activate":
  let app = NSRunningApplication(processIdentifier: pidArgument(2))
  emit(["activated": app?.activate(options: [.activateAllWindows]) ?? false])
case "symbols":
  emit(symbolReport())
case "disclaim":
  spawnDisclaimed(argument(2), Array(arguments.dropFirst(3)))
default:
  fail("unknown command \(command)")
}
