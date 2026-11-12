// The synthetic user: a window with its own text field that takes one character per second, posted at the HID
// level so it travels the same path as a person's keystroke. It is also the occluding sentinel window of the desktop
// observer: any key it receives that it did not post, and any click, is journalled as leaked input.

import AppKit
import ApplicationServices

final class Typist: NSObject {
  let window: NSWindow
  let field = NSTextField(frame: NSRect(x: 20, y: 110, width: 440, height: 24))
  let other = NSTextField(frame: NSRect(x: 20, y: 60, width: 440, height: 24))
  let source = CGEventSource(stateID: .hidSystemState)
  let alphabet = Array("abcdefghijklmnopqrstuvwxyz")
  var index = 0
  var timer: Timer?
  var dropNext = false
  var expected: [String] = []

  init(frame: NSRect) {
    window = NSWindow(contentRect: frame, styleMask: [.titled], backing: .buffered, defer: false)
    super.init()
    window.title = "Sentinel Typist"
    window.collectionBehavior = [.canJoinAllSpaces]
    field.setAccessibilityIdentifier("sentinel.field")
    other.setAccessibilityIdentifier("sentinel.other")
    window.contentView?.addSubview(field)
    window.contentView?.addSubview(other)
    NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .leftMouseDown, .rightMouseDown, .otherMouseDown]) {
      [weak self] event in
      self?.journal(event)
      return event
    }
  }

  func show() {
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
    window.makeFirstResponder(field)
    after(0.5) {
      if NSWorkspace.shared.frontmostApplication?.processIdentifier != getpid() { _ = axSetFrontmost(getpid()) }
      after(0.5) {
        emit([
          "ctl": "hello", "role": "typist", "pid": Int(getpid()), "window": self.window.windowNumber,
          "frontmost": NSWorkspace.shared.frontmostApplication?.processIdentifier == getpid(),
          "trusted": AXIsProcessTrusted(),
        ])
      }
    }
  }

  func journal(_ event: NSEvent) {
    guard event.type == .keyDown else {
      emit(["kind": "leak", "what": "mouse"])
      return
    }
    if let first = expected.first, event.characters == first {
      expected.removeFirst()
    } else {
      emit(["kind": "leak", "what": "key"])
    }
  }

  func typeNext() {
    let char = String(alphabet[index % alphabet.count])
    emit(["kind": "typed", "index": index, "char": char])
    index += 1
    if dropNext {
      dropNext = false
      emit(["ctl": "planted", "plant": "typing"])
      return
    }
    expected.append(char)
    var units = Array(char.utf16)
    for down in [true, false] {
      let event = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: down)
      event?.keyboardSetUnicodeString(stringLength: units.count, unicodeString: &units)
      event?.post(tap: .cghidEventTap)
    }
  }

  func command(_ words: [String]) {
    switch words.first {
    case "type":
      timer?.invalidate()
      let timer = Timer(timeInterval: 1.0, repeats: true) { [weak self] _ in self?.typeNext() }
      RunLoop.main.add(timer, forMode: .common)
      self.timer = timer
    case "reset":
      timer?.invalidate()
      timer = nil
      index = 0
      expected = []
      window.makeFirstResponder(nil)
      field.stringValue = ""
      window.makeFirstResponder(field)
      emit(["ctl": "reset"])
    case "drop-next":
      dropNext = true
    case "cover":
      let numbers = words.dropFirst().compactMap { Double($0) }
      if numbers.count == 4, let screen = NSScreen.screens.first {
        let top = screen.frame.maxY - numbers[1] - numbers[3]
        window.setFrame(NSRect(x: numbers[0], y: top, width: numbers[2], height: numbers[3]), display: true)
      }
      emit(["ctl": "covered"])
    case "quit":
      exit(0)
    default:
      emit(["ctl": "error", "detail": "unknown command \(words.joined(separator: " "))"])
    }
  }
}

@main
enum TypistMain {
  static func main() {
    let app = NSApplication.shared
    app.setActivationPolicy(.regular)
    let typist = Typist(frame: NSRect(x: 200, y: 400, width: 480, height: 180))
    readCommands { typist.command($0) }
    DispatchQueue.main.async { typist.show() }
    app.run()
  }
}
