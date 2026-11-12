// AX probe for the a11y leg of the fixture self-test: a11y-probe <pid> <window title>.
// Finds the fixture window by title under the application element for <pid>, then requires the page's
// controls to be visible in the AX tree: at least one button with a title and one text field beneath it.
// WKWebView and Electron expose the web content through NSAccessibility once renderer accessibility is on.
// Prints "A11Y buttons=<n> entries=<m>" and exits 0 when both are visible, 1 when a control class is
// missing, 3 (ENVIRONMENT) when this probe is not a trusted accessibility process or the window never
// appears within the wait. The workflow grants trust via TCC; a runner that refuses the grant is
// ENVIRONMENT, not a fixture failure.

import ApplicationServices
import Foundation

let waitSeconds = 20.0

func trusted() -> Bool {
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue as String: false] as CFDictionary
    return AXIsProcessTrustedWithOptions(options)
}

func children(_ element: AXUIElement) -> [AXUIElement] {
    var value: CFTypeRef?
    guard AXUIElementCopyChildren(element, &value) == .success, let items = value as? [AXUIElement] else { return [] }
    return items
}

func attribute(_ element: AXUIElement, _ name: String) -> String? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success,
          let text = value as? String
    else { return nil }
    return text
}

func walk(_ element: AXUIElement, depth: Int = 0, visit: (AXUIElement, String) -> Void) {
    guard depth <= 40 else { return }
    let role = attribute(element, kAXRoleAttribute as String) ?? ""
    visit(element, role)
    for child in children(element) {
        walk(child, depth: depth + 1, visit: visit)
    }
}

let arguments = CommandLine.arguments
guard arguments.count == 3, let pid = Int32(arguments[1]) else {
    FileHandle.standardError.write("usage: a11y-probe <pid> <window title>\n".data(using: .utf8)!)
    exit(2)
}
let title = arguments[2]

guard trusted() else {
    print("ENVIRONMENT: the probe is not a trusted accessibility process; grant it in TCC")
    exit(3)
}

let application = AXUIElementCreateApplication(pid)
let deadline = Date().addingTimeInterval(waitSeconds)
var window: AXUIElement?
while window == nil {
    for candidate in children(application) where attribute(candidate, kAXTitleAttribute as String) == title {
        window = candidate
    }
    if window == nil {
        if Date() >= deadline {
            print("ENVIRONMENT: no AX window titled \"\(title)\" for pid \(pid) within 20s")
            exit(3)
        }
        Thread.sleep(forTimeInterval: 0.5)
    }
}

var buttons = 0
var entries = 0
let deadlineControls = Date().addingTimeInterval(waitSeconds)
repeat {
    buttons = 0
    entries = 0
    walk(window!) { element, role in
        switch role {
        case "AXButton" where attribute(element, kAXTitleAttribute as String)?.isEmpty == false:
            buttons += 1
        case "AXTextField", "AXTextArea":
            let label = attribute(element, kAXTitleAttribute as String) ?? attribute(element, kAXDescriptionAttribute as String) ?? ""
            if !label.isEmpty { entries += 1 }
        default: break
        }
    }
    if buttons >= 1 && entries >= 1 { break }
    Thread.sleep(forTimeInterval: 0.5)
} while Date() < deadlineControls

print("A11Y buttons=\(buttons) entries=\(entries)")
exit(buttons >= 1 && entries >= 1 ? 0 : 1)
