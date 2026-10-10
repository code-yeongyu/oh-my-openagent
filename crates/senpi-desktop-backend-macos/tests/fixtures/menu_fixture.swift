// A one-window AppKit app with a real NSMenu, for the menu live test.
// argv[1] = window title, argv[2] = path of the temp file the fixture records
// each invoked menu command's title to.
import AppKit

final class Delegate: NSObject, NSApplicationDelegate {
    var window: NSWindow?
    var recordPath: String = ""

    @objc func record(_ sender: NSMenuItem) {
        try? (sender.title + "\n").write(toFile: recordPath, atomically: true, encoding: .utf8)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let args = CommandLine.arguments
        let title = args.count > 1 ? args[1] : "senpi-menu-fixture"
        recordPath = args.count > 2 ? args[2] : ""

        // AppKit renders the main menu's first item as the application menu
        // (titled with the process name), so File must come second.
        let mainMenu = NSMenu()
        let appItem = NSMenuItem(title: "", action: nil, keyEquivalent: "")
        appItem.submenu = NSMenu(title: "")
        mainMenu.addItem(appItem)
        let fileItem = NSMenuItem(title: "File", action: nil, keyEquivalent: "")
        let fileMenu = NSMenu(title: "File")
        // Manual enabling, so Revert stays disabled even though the delegate
        // responds to its action.
        fileMenu.autoenablesItems = false
        fileMenu.addItem(NSMenuItem(title: "Save", action: #selector(record(_:)), keyEquivalent: "s"))
        fileMenu.addItem(NSMenuItem.separator())
        let exportItem = NSMenuItem(title: "Export…", action: nil, keyEquivalent: "")
        let exportMenu = NSMenu(title: "Export…")
        exportMenu.addItem(NSMenuItem(title: "PDF", action: #selector(record(_:)), keyEquivalent: ""))
        exportItem.submenu = exportMenu
        fileMenu.addItem(exportItem)
        let revert = NSMenuItem(title: "Revert", action: #selector(record(_:)), keyEquivalent: "")
        revert.isEnabled = false
        fileMenu.addItem(revert)
        fileItem.submenu = fileMenu
        mainMenu.addItem(fileItem)

        let editItem = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(NSMenuItem(title: "Undo", action: nil, keyEquivalent: "z"))
        editItem.submenu = editMenu
        mainMenu.addItem(editItem)
        NSApp.mainMenu = mainMenu

        let window = NSWindow(
            contentRect: NSRect(x: 260, y: 260, width: 360, height: 120),
            styleMask: [.titled],
            backing: .buffered,
            defer: false
        )
        window.title = title
        window.orderFrontRegardless()
        self.window = window
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = Delegate()
app.delegate = delegate
app.run()
