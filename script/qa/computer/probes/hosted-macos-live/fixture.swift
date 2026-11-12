import AppKit
import Foundation

final class Fixture: NSObject, NSApplicationDelegate {
  let stateFile: String
  let readyFile: String
  var window: NSWindow?
  var checkbox: NSButton?

  init(stateFile: String, readyFile: String) {
    self.stateFile = stateFile
    self.readyFile = readyFile
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    let window = NSWindow(
      contentRect: NSRect(x: 240, y: 240, width: 360, height: 240), styleMask: [.titled], backing: .buffered,
      defer: false)
    window.title = "omo probe fixture"
    let view = NSView(frame: NSRect(x: 0, y: 0, width: 360, height: 240))
    view.wantsLayer = true
    view.layer?.backgroundColor = NSColor(srgbRed: 1, green: 0.5, blue: 0, alpha: 1).cgColor
    let checkbox = NSButton(checkboxWithTitle: "probe", target: self, action: #selector(toggled))
    checkbox.frame = NSRect(x: 40, y: 100, width: 200, height: 40)
    view.addSubview(checkbox)
    window.contentView = view
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
    self.window = window
    self.checkbox = checkbox
    DispatchQueue.main.async { self.writeReady() }
  }

  func writeReady() {
    guard let window, let checkbox, let primary = NSScreen.screens.first else { fail("fixture: no window or screen") }
    let onScreen = window.convertToScreen(checkbox.convert(checkbox.bounds, to: nil))
    let ready: [String: Any] = [
      "pid": Int(getpid()), "windowNumber": window.windowNumber,
      "x": Double(onScreen.midX), "y": Double(primary.frame.height - onScreen.midY),
    ]
    let data = try! JSONSerialization.data(withJSONObject: ready, options: [.sortedKeys])
    FileManager.default.createFile(atPath: readyFile, contents: data)
  }

  @objc func toggled() {
    let line = (checkbox?.state == .on ? "on" : "off") + "\n"
    if let handle = FileHandle(forWritingAtPath: stateFile) {
      handle.seekToEndOfFile()
      handle.write(Data(line.utf8))
      handle.closeFile()
    } else {
      FileManager.default.createFile(atPath: stateFile, contents: Data(line.utf8))
    }
  }
}
