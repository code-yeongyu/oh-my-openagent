import AppKit
import WebKit

// Usage: Conformance Fixture --report <path>. A WKWebView host of the shared page (../web) with native menus;
// same report and stdin control protocol as native-linux/fixture.py.
final class Host: NSObject, WKScriptMessageHandler {
    let reportPath: String
    let sabotage = ProcessInfo.processInfo.environment["CONFORMANCE_FIXTURE_SABOTAGE"] ?? ""
    let page: URL
    var windows: [(window: NSWindow, view: WKWebView)] = []
    var states: [ObjectIdentifier: [String: Any]] = [:]
    var initial: [String: [String: Any]]?
    var menuItems: [String: NSMenuItem] = [:]

    init(reportPath: String) {
        self.reportPath = reportPath
        guard let bundled = Bundle.main.url(forResource: "index", withExtension: "html") else {
            fatalError("the app bundle carries no index.html; build it with build.sh")
        }
        page = bundled
        super.init()
        NSApp.mainMenu = buildMenu()
    }

    func openWindow(loaded: @escaping () -> Void) {
        let number = windows.count + 1
        let content = WKUserContentController()
        content.addUserScript(WKUserScript(
            source: "window.conformanceHost = { hideA11y: \(sabotage == "a11y"), post: (json) => window.webkit.messageHandlers.report.postMessage(json) }",
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        content.add(self, name: "report")
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController = content
        let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 640, height: 720), configuration: configuration)
        let window = NSWindow(contentRect: NSRect(x: 100, y: 100, width: 640, height: 720),
                              styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.title = number == 1 ? "Conformance Document" : "Conformance Document \(number)"
        window.isReleasedWhenClosed = false
        window.contentView = view
        windows.append((window, view))
        let delegate = LoadDelegate(loaded)
        loadDelegates.append(delegate)
        view.navigationDelegate = delegate
        view.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent())
        window.makeKeyAndOrderFront(nil)
    }

    private var loadDelegates: [LoadDelegate] = []

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let json = message.body as? String, let view = message.webView,
              let state = parse(json) else { return }
        states[ObjectIdentifier(view)] = state
        write()
    }

    private func parse(_ json: String) -> [String: Any]? {
        guard let data = json.data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    func evaluate(_ view: WKWebView, _ script: String, done: @escaping (String?) -> Void) {
        view.evaluateJavaScript("JSON.stringify(\(script))") { [unowned self] value, error in
            if let error { done("ERR \(error.localizedDescription)"); return }
            guard let json = value as? String, let state = parse(json) else { done("ERR no state from the page"); return }
            states[ObjectIdentifier(view)] = state
            write()
            done(nil)
        }
    }

    func menu(_ path: String, done: @escaping (String?) -> Void) {
        if path == "File/New Window" {
            openWindow { [unowned self] in write(); done(nil) }
            return
        }
        let view = (windows.first { $0.window.isKeyWindow } ?? windows[0]).view
        evaluate(view, "conformance.menu(\(literal(path)))", done: done)
    }

    private func buildMenu() -> NSMenu {
        let bar = NSMenu()
        let appItem = NSMenuItem()
        appItem.submenu = NSMenu(title: "Conformance Fixture")
        appItem.submenu?.addItem(withTitle: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        bar.addItem(appItem)
        let menus: [(String, [String])] = [
            ("File", ["Save", "Rename…", "New Window"]), ("Edit", ["Undo"]),
            ("Priority", ["Low", "Normal", "High"]), ("Test", ["Conformance"]),
        ]
        for (title, labels) in menus {
            let top = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            top.submenu = NSMenu(title: title)
            for label in labels {
                let item = NSMenuItem(title: label, action: #selector(menuClicked(_:)), keyEquivalent: "")
                item.target = self
                item.representedObject = "\(title)/\(label)"
                menuItems["\(title)/\(label)"] = item
                top.submenu?.addItem(item)
            }
            bar.addItem(top)
        }
        return bar
    }

    @objc private func menuClicked(_ item: NSMenuItem) {
        if let path = item.representedObject as? String { menu(path) { _ in } }
    }

    func write() {
        guard let first = windows.first, let main = states[ObjectIdentifier(first.view)] else { return }
        var fields = main["fields"] as? [String: Any] ?? [:]
        var saved = main["saved"] as? [String: Any] ?? [:]
        saved["savedDocuments"] = windows.filter { (states[ObjectIdentifier($0.view)]?["savedOnce"] as? Bool) == true }.count
        if initial == nil { initial = ["fields": fields, "saved": saved] }
        if fields[sabotage] != nil { fields[sabotage] = initial?["fields"]?[sabotage] }
        if saved[sabotage] != nil { saved[sabotage] = initial?["saved"]?[sabotage] }
        let report: [String: Any] = [
            "schema": "omo-conformance-fixture/1", "app": "Conformance Fixture", "toolkit": "webview",
            "windows": windows.map(\.window.title), "appKey": Bundle.main.bundleIdentifier ?? "", "fields": fields, "saved": saved,
        ]
        guard var data = try? JSONSerialization.data(withJSONObject: report, options: [.sortedKeys, .prettyPrinted]) else { return }
        data.append(0x0A)
        try? data.write(to: URL(fileURLWithPath: reportPath), options: .atomic)
    }

    func control(_ line: String, answer: @escaping (String) -> Void) {
        let parts = line.split(separator: " ", maxSplits: 1).map(String.init)
        let rest = parts.count == 2 ? parts[1] : ""
        let reply: (String?) -> Void = { error in answer(error ?? "OK \(line)") }
        switch parts.first {
        case "poke": evaluate(windows[0].view, "conformance.poke(\(literal(rest)))", done: reply)
        case "menu": menu(rest, done: reply)
        case "set":
            let field = rest.split(separator: " ", maxSplits: 1).map(String.init)
            let text = field.count == 2 ? field[1] : ""
            evaluate(windows[0].view, "conformance.set(\(literal(field.first ?? "")), \(literal(text)))", done: reply)
        default: answer("ERR unknown control line \(line)")
        }
    }

    private func literal(_ text: String) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: [text])) ?? Data("[\"\"]".utf8)
        return String(decoding: data, as: UTF8.self).dropFirst().dropLast().description
    }
}

final class LoadDelegate: NSObject, WKNavigationDelegate {
    private var loaded: (() -> Void)?
    init(_ loaded: @escaping () -> Void) { self.loaded = loaded }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loaded?()
        loaded = nil
    }
}

let arguments = CommandLine.arguments
guard arguments.count == 3, arguments[1] == "--report" else {
    FileHandle.standardError.write(Data("usage: Conformance Fixture --report <path>\n".utf8))
    exit(2)
}
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let host = Host(reportPath: arguments[2])
host.openWindow {
    host.evaluate(host.windows[0].view, "conformance.state()") { _ in
        print("READY pid=\(ProcessInfo.processInfo.processIdentifier)")
        fflush(stdout)
        Thread {
            while let line = readLine() {
                if line.isEmpty { continue }
                if line == "quit" { break }
                let done = DispatchSemaphore(value: 0)
                var answer = ""
                DispatchQueue.main.async { host.control(line) { answer = $0; done.signal() } }
                done.wait()
                print(answer)
                fflush(stdout)
            }
            DispatchQueue.main.async { NSApp.terminate(nil) }
        }.start()
    }
}
app.run()
