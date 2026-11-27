import Darwin
import Foundation
import ObjectiveC

let skyLightPath = "/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight"

let privateSymbols = [
  "SLSEventPostToPid", "SLEventPostToPid", "SLSHWCaptureWindowList", "SLSSetFrontProcessWithInfo",
  "SLSCopySpacesForWindows", "SLSMoveWindowsToManagedSpace", "SLEventSetAuthenticationMessage",
  "SLSSetConnectionProperty", "SLSMainConnectionID", "CPSReleaseKeyFocus", "_AXUIElementRemoteTokenCreate",
  "_AXUIElementCreateWithRemoteToken",
]

let controlSymbols = ["CGEventPostToPid", "AXIsProcessTrusted"]

func classMethods(_ name: String) -> [String]? {
  guard let cls = NSClassFromString(name), let meta = object_getClass(cls) else { return nil }
  var count: UInt32 = 0
  guard let methods = class_copyMethodList(meta, &count) else { return [] }
  defer { free(methods) }
  return (0..<Int(count)).map { NSStringFromSelector(method_getName(methods[$0])) }.sorted()
}

func symbolReport() -> [String: Any] {
  let skyLight = dlopen(skyLightPath, RTLD_NOW)
  let resolves = { (name: String) -> Bool in
    dlsym(defaultHandle, name) != nil || (skyLight.map { dlsym($0, name) != nil } ?? false)
  }
  var report: [String: Any] = [
    "skyLightOpened": skyLight != nil,
    "controls": Dictionary(uniqueKeysWithValues: controlSymbols.map { ($0, resolves($0)) }),
    "private": Dictionary(uniqueKeysWithValues: privateSymbols.map { ($0, resolves($0)) }),
  ]
  report["SLSEventAuthenticationMessage.classMethods"] = classMethods("SLSEventAuthenticationMessage") ?? NSNull()
  return report
}
