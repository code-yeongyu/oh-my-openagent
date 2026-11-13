// A one-window AppKit app with a real NSPopUpButton, for the popup live test.
// It orders its window in without activating, so the test also shows whether
// choosing an option moves the user's front app.
import AppKit

final class Delegate: NSObject, NSApplicationDelegate {
    var window: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let window = NSWindow(
            contentRect: NSRect(x: 240, y: 240, width: 360, height: 120),
            styleMask: [.titled],
            backing: .buffered,
            defer: false
        )
        window.title = CommandLine.arguments.dropFirst().first ?? "senpi-popup-fixture"
        let popup = NSPopUpButton(frame: NSRect(x: 20, y: 46, width: 240, height: 28), pullsDown: false)
        popup.autoenablesItems = false
        popup.addItems(withTitles: ["Rich Text", "Web Page (.html)", "Plain Text"])
        popup.menu?.insertItem(NSMenuItem.separator(), at: 1)
        let disabled = NSMenuItem(title: "Disabled Option", action: nil, keyEquivalent: "")
        disabled.isEnabled = false
        popup.menu?.addItem(disabled)
        window.contentView?.addSubview(popup)
        window.orderFrontRegardless()
        self.window = window
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = Delegate()
app.delegate = delegate
app.run()
