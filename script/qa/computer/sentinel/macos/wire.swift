// Shared by the sentinel's recorder, typist and planter. Every line a helper prints is one JSON object; `t` is
// milliseconds on CLOCK_UPTIME_RAW, the one clock all three processes read, so their events order on one timeline.
// Lines with a `kind` are sentinel events (script/qa/computer/sentinel/events.ts); lines with a `ctl` talk to the driver.

import AppKit
import ApplicationServices
import Foundation

func uptimeMs() -> Double { Double(clock_gettime_nsec_np(CLOCK_UPTIME_RAW)) / 1_000_000 }

private let outputLock = NSLock()

func emit(_ fields: [String: Any]) {
  var object = fields
  if object["t"] == nil { object["t"] = uptimeMs() }
  guard JSONSerialization.isValidJSONObject(object),
    let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
  else { return }
  outputLock.lock()
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data([0x0a]))
  outputLock.unlock()
}

/// Reads one command per stdin line on a background thread and hands each to `handle` on the main thread; end of
/// input is delivered as "quit" so a dead driver never leaves a helper behind.
func readCommands(_ handle: @escaping ([String]) -> Void) {
  Thread.detachNewThread {
    while let line = readLine() {
      let words = line.split(separator: " ").map(String.init)
      if !words.isEmpty { DispatchQueue.main.async { handle(words) } }
    }
    DispatchQueue.main.async { handle(["quit"]) }
  }
}

func argument(_ name: String) -> String? {
  let all = CommandLine.arguments
  guard let index = all.firstIndex(of: name), index + 1 < all.count else { return nil }
  return all[index + 1]
}

func after(_ seconds: Double, _ work: @escaping () -> Void) {
  DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
}

// MARK: accessibility

func axValue(_ element: AXUIElement, _ name: String) -> (AXError, CFTypeRef?) {
  var value: CFTypeRef?
  let error = AXUIElementCopyAttributeValue(element, name as CFString, &value)
  return (error, value)
}

func axString(_ element: AXUIElement, _ name: String) -> String? {
  axValue(element, name).1 as? String
}

func axElement(_ element: AXUIElement, _ name: String) -> AXUIElement? {
  guard let value = axValue(element, name).1, CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
  return unsafeBitCast(value, to: AXUIElement.self)
}

func axChildren(_ element: AXUIElement) -> [AXUIElement] {
  guard let value = axValue(element, kAXChildrenAttribute).1 as? [AnyObject] else { return [] }
  return value.compactMap { CFGetTypeID($0) == AXUIElementGetTypeID() ? unsafeBitCast($0, to: AXUIElement.self) : nil }
}

func axIdentity(_ element: AXUIElement) -> String {
  [kAXIdentifierAttribute, kAXRoleAttribute, kAXTitleAttribute].map { axString(element, $0) ?? "" }.joined(separator: "/")
}

func axFind(_ root: AXUIElement, identifier: String, depth: Int = 10) -> AXUIElement? {
  if axString(root, kAXIdentifierAttribute) == identifier { return root }
  guard depth > 0 else { return nil }
  for child in axChildren(root) {
    if let hit = axFind(child, identifier: identifier, depth: depth - 1) { return hit }
  }
  return nil
}

func policyName(_ policy: NSApplication.ActivationPolicy) -> String {
  switch policy {
  case .regular: return "regular"
  case .accessory: return "accessory"
  case .prohibited: return "prohibited"
  @unknown default: return "unknown"
  }
}

func axErrorName(_ error: AXError) -> String {
  switch error {
  case .success: return "success"
  case .noValue: return "noValue"
  case .attributeUnsupported: return "attributeUnsupported"
  case .cannotComplete: return "cannotComplete"
  case .invalidUIElement: return "invalidUIElement"
  case .failure: return "failure"
  case .apiDisabled: return "apiDisabled"
  case .notImplemented: return "notImplemented"
  default: return "ax\(error.rawValue)"
  }
}

func axSetFrontmost(_ pid: pid_t) -> AXError {
  AXUIElementSetAttributeValue(AXUIElementCreateApplication(pid), kAXFrontmostAttribute as CFString, kCFBooleanTrue)
}

// MARK: private symbols, resolved at run time; a missing symbol is reported, never guessed around

private let defaultHandle = UnsafeMutableRawPointer(bitPattern: -2)

func privateSymbol<T>(_ names: [String], as type: T.Type) -> T? {
  for name in names {
    if let pointer = dlsym(defaultHandle, name) { return unsafeBitCast(pointer, to: type) }
  }
  return nil
}

private typealias ConnectionFn = @convention(c) () -> Int32
private typealias ActiveSpaceFn = @convention(c) (Int32) -> UInt64
private typealias CopySpacesFn = @convention(c) (Int32) -> Unmanaged<CFArray>?
typealias WindowOfElementFn = @convention(c) (AXUIElement, UnsafeMutablePointer<CGWindowID>) -> AXError

private let mainConnection = privateSymbol(["SLSMainConnectionID", "CGSMainConnectionID"], as: ConnectionFn.self)
private let getActiveSpace = privateSymbol(["SLSGetActiveSpace", "CGSGetActiveSpace"], as: ActiveSpaceFn.self)
private let copyManagedSpaces = privateSymbol(
  ["SLSCopyManagedDisplaySpaces", "CGSCopyManagedDisplaySpaces"], as: CopySpacesFn.self)
let windowOfElement = privateSymbol(["_AXUIElementGetWindow"], as: WindowOfElementFn.self)

func activeSpaceId() -> UInt64? {
  guard let mainConnection, let getActiveSpace else { return nil }
  return getActiveSpace(mainConnection())
}

func managedSpaceCount() -> Int? {
  guard let mainConnection, let copyManagedSpaces,
    let displays = copyManagedSpaces(mainConnection())?.takeRetainedValue() as? [[String: Any]]
  else { return nil }
  return displays.reduce(0) { $0 + (($1["Spaces"] as? [Any])?.count ?? 0) }
}

// MARK: window list

struct ListedWindow {
  let number: UInt32
  let ownerPid: pid_t
  let owner: String
  let layer: Int
  var id: String { "\(owner)#\(number)" }
}

func listWindows() -> [ListedWindow]? {
  let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
  guard let raw = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else { return nil }
  return raw.compactMap { info in
    guard let number = info[kCGWindowNumber as String] as? UInt32,
      let pid = info[kCGWindowOwnerPID as String] as? pid_t,
      let layer = info[kCGWindowLayer as String] as? Int
    else { return nil }
    return ListedWindow(number: number, ownerPid: pid, owner: info[kCGWindowOwnerName as String] as? String ?? "?", layer: layer)
  }
}

func pointerLocation() -> CGPoint? { CGEvent(source: nil)?.location }
