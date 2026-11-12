import AppKit
import ApplicationServices
import CoreGraphics
import Darwin
import Foundation

func createListenTap(_ callback: CGEventTapCallBack) -> CFMachPort? {
  CGEvent.tapCreate(
    tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
    eventsOfInterest: CGEventMask(1 << CGEventType.keyDown.rawValue), callback: callback, userInfo: nil)
}

let passThrough: CGEventTapCallBack = { _, _, event, _ in Unmanaged.passUnretained(event) }

enum Watch {
  static var keycode: Int64 = 0
  static var events: [[String: Int64]] = []
}

let watchCallback: CGEventTapCallBack = { _, type, event, _ in
  if type == .keyDown && event.getIntegerValueField(.keyboardEventKeycode) == Watch.keycode {
    Watch.events.append([
      "userData": event.getIntegerValueField(.eventSourceUserData),
      "sourcePid": event.getIntegerValueField(.eventSourceUnixProcessID),
      "sourceStateId": event.getIntegerValueField(.eventSourceStateID),
    ])
    if Watch.events.count >= 2 { CFRunLoopStop(CFRunLoopGetMain()) }
  }
  return Unmanaged.passUnretained(event)
}

func postMouse(pid: pid_t, windowNumber: Int64, at point: CGPoint) {
  for type in [CGEventType.leftMouseDown, .leftMouseUp] {
    guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left)
    else { fail("click: CGEvent creation failed") }
    event.setIntegerValueField(.mouseEventClickState, value: 1)
    if let underPointer = CGEventField(rawValue: 91) { event.setIntegerValueField(underPointer, value: windowNumber) }
    if let canHandle = CGEventField(rawValue: 92) { event.setIntegerValueField(canHandle, value: windowNumber) }
    event.postToPid(pid)
    usleep(40_000)
  }
}

func spawnDisclaimed(_ path: String, _ rest: [String]) -> Never {
  typealias SetDisclaim = @convention(c) (UnsafeMutablePointer<posix_spawnattr_t?>, Int32) -> Int32
  guard let symbol = dlsym(defaultHandle, "responsibility_spawnattrs_setdisclaim") else {
    fail("responsibility_spawnattrs_setdisclaim is not exported", code: 3)
  }
  var attributes: posix_spawnattr_t?
  posix_spawnattr_init(&attributes)
  guard unsafeBitCast(symbol, to: SetDisclaim.self)(&attributes, 1) == 0 else { fail("setdisclaim failed", code: 3) }
  let argv: [UnsafeMutablePointer<CChar>?] = ([path] + rest).map { strdup($0) } + [nil]
  var child: pid_t = 0
  let spawned = posix_spawn(&child, path, nil, &attributes, argv, environ)
  guard spawned == 0 else { fail("posix_spawn failed: \(spawned)", code: 3) }
  var status: Int32 = 0
  waitpid(child, &status, 0)
  exit((status >> 8) & 0xff)
}
