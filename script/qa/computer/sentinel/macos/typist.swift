// The synthetic user: a window with its own text field that takes one character per second, posted at the HID
// level so it travels the same path as a person's keystroke. It is also the occluding sentinel window of the desktop
// observer: any key it receives that it did not post, and any click, is journalled as leaked input.

import AppKit
import ApplicationServices

final class Typist: NSObject {
  let window: NSWindow
  // Text views, not text fields: a text field selects all of its text when it regains focus, so the next keystroke
  // would replace it and a focus steal would always read as a typing loss too.
  let field = Typist.textView(NSRect(x: 20, y: 100, width: 440, height: 40), "sentinel.field")
  let other = Typist.textView(NSRect(x: 20, y: 40, width: 440, height: 40), "sentinel.other")
  let source = CGEventSource(stateID: .hidSystemState)
  let alphabet = Array("abcdefghijklmnopqrstuvwxyz")
  var index = 0
  var timer: Timer?
  var dropNext = false
  var expected: [String] = []

  static func textView(_ frame: NSRect, _ identifier: String) -> NSTextView {
    let view = NSTextView(frame: frame)
    view.isRichText = false
    view.isAutomaticSpellingCorrectionEnabled = false
    view.isContinuousSpellCheckingEnabled = false
    view.isAutomaticTextReplacementEnabled = false
    view.isAutomaticQuoteSubstitutionEnabled = false
    view.isAutomaticDashSubstitutionEnabled = false
    view.isAutomaticTextCompletionEnabled = false
    view.setAccessibilityIdentifier(identifier)
    return view
  }

  init(frame: NSRect) {
    window = NSWindow(contentRect: frame, styleMask: [.titled], backing: .buffered, defer: false)
    super.init()
    window.title = "Sentinel Typist"
    window.collectionBehavior = [.canJoinAllSpaces]
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

  // An activation through LaunchServices brings the app forward without making its window key again; keystrokes
  // then reach no field. Every segment and every return from an activation re-keys the field explicitly.
  func takeKeyFocus() {
    window.makeKeyAndOrderFront(nil)
    window.makeFirstResponder(field)
    field.setSelectedRange(NSRange(location: field.string.utf16.count, length: 0))
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
      field.string = ""
      takeKeyFocus()
      emit(["ctl": "reset"])
    case "yield":
      guard let pid = words.dropFirst().first.flatMap({ pid_t($0) }), let app = NSRunningApplication(processIdentifier: pid)
      else { return emit(["ctl": "error", "detail": "usage: yield <pid>"]) }
      if #available(macOS 14.0, *) { NSApp.yieldActivation(to: app) }
      emit(["ctl": "yielded"])
    case "activate":
      if #available(macOS 14.0, *) { NSApp.activate() } else { NSApp.activate(ignoringOtherApps: true) }
      after(0.15) {
        self.takeKeyFocus()
        emit([
          "ctl": "activated", "frontmost": NSWorkspace.shared.frontmostApplication?.processIdentifier == getpid(),
          "key": self.window.isKeyWindow && self.window.firstResponder === self.field,
        ])
      }
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
