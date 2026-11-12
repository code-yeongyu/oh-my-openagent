import AppKit

// Usage: Conformance Fixture --report <path>. Same report and stdin control protocol as
// native-linux/fixture.py: READY pid=<pid>, then poke/set/menu/quit lines answered by OK or ERR.
final class Fixture: NSObject {
    let reportPath: String
    let sabotage = ProcessInfo.processInfo.environment["CONFORMANCE_FIXTURE_SABOTAGE"] ?? ""
    var windows: [DocumentWindow] = []
    private var initial: [String: [String: Any]]?
    private var menuActions: [ObjectIdentifier: (DocumentWindow) -> Void] = [:]
    var menuItems: [String: NSMenuItem] = [:]

    init(reportPath: String) {
        self.reportPath = reportPath
        super.init()
        NSApp.mainMenu = buildMenu()
        openWindow()
        initial = sections()
        write()
    }

    func openWindow() {
        let window = DocumentWindow(number: windows.count + 1) { [unowned self] in changed() }
        windows.append(window)
        window.makeKeyAndOrderFront(nil)
        changed()
    }

    func changed() { if initial != nil { write() } }

    private func buildMenu() -> NSMenu {
        let bar = NSMenu()
        let appItem = NSMenuItem()
        appItem.submenu = NSMenu(title: "Conformance Fixture")
        appItem.submenu?.addItem(withTitle: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        bar.addItem(appItem)
        let menus: [(String, [(String, (DocumentWindow) -> Void)])] = [
            ("File", [("Save", { $0.save() }), ("Rename…", { $0.rename() }), ("New Window", { [unowned self] _ in openWindow() })]),
            ("Edit", [("Undo", { $0.fields.undo() })]),
            ("Priority", ["Low", "Normal", "High"].map { name in (name, { [unowned self] in $0.priority = name; changed() }) }),
            ("Test", [("Conformance", { [unowned self] in $0.menuSelection = "Conformance"; changed() })]),
        ]
        for (title, entries) in menus {
            let top = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            top.submenu = NSMenu(title: title)
            for (label, action) in entries {
                let item = NSMenuItem(title: label, action: #selector(menuClicked(_:)), keyEquivalent: "")
                item.target = self
                menuActions[ObjectIdentifier(item)] = action
                menuItems["\(title)/\(label)"] = item
                top.submenu?.addItem(item)
            }
            bar.addItem(top)
        }
        return bar
    }

    @objc private func menuClicked(_ item: NSMenuItem) {
        let window = (NSApp.keyWindow as? DocumentWindow) ?? windows[0]
        menuActions[ObjectIdentifier(item)]?(window)
    }

    private func sections() -> [String: [String: Any]] {
        let main = windows[0]
        let fields: [String: Any] = [
            "value": main.fields.text("Value"), "receivedKeys": main.chords.joined(separator: ","),
            "pressCount": main.pressCount, "scrollSteps": main.scrollTarget.steps,
            "dragOrder": main.dragList.order.joined(separator: ","), "menuSelection": main.menuSelection,
        ]
        var saved = main.saved
        saved["savedDocuments"] = windows.filter(\.savedOnce).count
        return ["fields": fields, "saved": saved]
    }

    func write() {
        var current = sections()
        for section in ["fields", "saved"] where current[section]?[sabotage] != nil {
            current[section]?[sabotage] = initial?[section]?[sabotage]
        }
        let report: [String: Any] = [
            "schema": "omo-conformance-fixture/1", "app": "Conformance Fixture", "toolkit": "native",
            "fields": current["fields"] ?? [:], "saved": current["saved"] ?? [:],
        ]
        guard var data = try? JSONSerialization.data(withJSONObject: report, options: [.sortedKeys, .prettyPrinted]) else { return }
        data.append(0x0A)
        try? data.write(to: URL(fileURLWithPath: reportPath), options: .atomic)
    }

    func poke(_ action: String) throws {
        let main = windows[0]
        switch action {
        case "click", "ax.perform": main.press.performClick(nil)
        case "typeText": main.fields.set("Value", main.fields.text("Value") + "conformance")
        case "ax.setValue": main.fields.set("Value", "conformance")
        case "keyChord": main.pokeChord()
        case "scroll": main.scrollTarget.pokeWheelDown(3)
        case "drag": main.dragList.pokeDrag(from: "b", to: "a")
        case "menu.select":
            guard let item = menuItems["Test/Conformance"] else { throw ControlError.unknown("no Test/Conformance item") }
            menuClicked(item)
        default: throw ControlError.unknown("unknown action \(action)")
        }
    }

    func control(_ line: String) throws -> String {
        let parts = line.split(separator: " ", maxSplits: 1).map(String.init)
        let rest = parts.count == 2 ? parts[1] : ""
        switch parts.first {
        case "poke": try poke(rest)
        case "menu":
            guard let item = menuItems[rest] else { throw ControlError.unknown("unknown menu item \(rest)") }
            menuClicked(item)
        case "set":
            let field = rest.split(separator: " ", maxSplits: 1).map(String.init)
            guard let label = field.first, windows[0].fields.widget(label) != nil else { throw ControlError.unknown("unknown field \(rest)") }
            windows[0].fields.set(label, field.count == 2 ? field[1] : "")
        default: throw ControlError.unknown("unknown control line \(line)")
        }
        write()
        return "OK \(line)"
    }
}

enum ControlError: Error { case unknown(String) }

let arguments = CommandLine.arguments
guard arguments.count == 3, arguments[1] == "--report" else {
    FileHandle.standardError.write(Data("usage: Conformance Fixture --report <path>\n".utf8))
    exit(2)
}
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let fixture = Fixture(reportPath: arguments[2])
print("READY pid=\(ProcessInfo.processInfo.processIdentifier)")
fflush(stdout)
Thread {
    while let line = readLine() {
        if line.isEmpty { continue }
        if line == "quit" { break }
        var answer = ""
        DispatchQueue.main.sync {
            do { answer = try fixture.control(line) } catch ControlError.unknown(let reason) { answer = "ERR \(reason)" } catch { answer = "ERR \(error)" }
        }
        print(answer)
        fflush(stdout)
    }
    DispatchQueue.main.async { NSApp.terminate(nil) }
}.start()
app.run()
