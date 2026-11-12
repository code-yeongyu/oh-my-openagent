import AppKit
import ApplicationServices
import CoreGraphics
import Darwin
import Foundation

let defaultHandle = UnsafeMutableRawPointer(bitPattern: -2)

func responsiblePid(_ pid: pid_t) -> Int {
  typealias Resolve = @convention(c) (pid_t) -> pid_t
  guard let symbol = dlsym(defaultHandle, "responsibility_get_pid_responsible_for_pid") else { return -1 }
  return Int(unsafeBitCast(symbol, to: Resolve.self)(pid))
}

func axValue(_ element: AXUIElement, _ name: String) -> AnyObject? {
  var value: AnyObject?
  return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}

func axChildren(_ element: AXUIElement) -> [AXUIElement] {
  (axValue(element, kAXChildrenAttribute) as? [AXUIElement]) ?? []
}

func firstElement(_ root: AXUIElement, role: String, depth: Int = 0) -> AXUIElement? {
  if (axValue(root, kAXRoleAttribute) as? String) == role { return root }
  guard depth < 12 else { return nil }
  for child in axChildren(root) {
    if let found = firstElement(child, role: role, depth: depth + 1) { return found }
  }
  return nil
}

func axTree(_ pid: pid_t) -> [String: Any] {
  let app = AXUIElementCreateApplication(pid)
  var windowsValue: AnyObject?
  let error = AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &windowsValue)
  let windows = (windowsValue as? [AXUIElement]) ?? []
  var nodes = 0
  var roles: [String: Int] = [:]
  func walk(_ element: AXUIElement, _ depth: Int) {
    nodes += 1
    if let role = axValue(element, kAXRoleAttribute) as? String { roles[role, default: 0] += 1 }
    guard depth < 12, nodes < 4000 else { return }
    for child in axChildren(element) { walk(child, depth + 1) }
  }
  for window in windows { walk(window, 0) }
  return ["axError": Int(error.rawValue), "windows": windows.count, "nodes": nodes, "roles": roles]
}

func permissions() -> [String: Any] {
  [
    "pid": Int(getpid()),
    "responsiblePid": responsiblePid(getpid()),
    "axTrusted": AXIsProcessTrusted(),
    "screenCapturePreflight": CGPreflightScreenCaptureAccess(),
    "listenEventPreflight": CGPreflightListenEventAccess(),
    "postEventPreflight": CGPreflightPostEventAccess(),
  ]
}
