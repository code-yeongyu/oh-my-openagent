import AppKit

final class DocumentWindow: NSWindow {
    var pressCount = 0
    var chords: [String] = []
    var menuSelection = ""
    var priority = ""
    var documentName = "Document"
    var items: [String] = []
    var doneRow = 0
    var savedOnce = false
    var saved: [String: Any] = [:]
    let fields: TextFields
    let press = NSButton(title: "Press", target: nil, action: nil)
    let archived = NSButton(checkboxWithTitle: "Archived", target: nil, action: nil)
    let scrollTarget = ScrollTarget(frame: NSRect(x: 0, y: 0, width: 600, height: 40))
    let dragList = DragList(frame: NSRect(x: 0, y: 0, width: 600, height: 60))
    private let rows = NSPopUpButton(frame: .zero, pullsDown: false)
    private let changed: () -> Void
    private var handlers: [ObjectIdentifier: () -> Void] = [:]

    init(number: Int, changed: @escaping () -> Void) {
        self.changed = changed
        fields = TextFields(onChange: changed)
        super.init(contentRect: NSRect(x: 100, y: 100, width: 640, height: 720),
                   styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        title = number == 1 ? "Document" : "Document \(number)"
        isReleasedWhenClosed = false
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.edgeInsets = NSEdgeInsets(top: 8, left: 8, bottom: 8, right: 8)
        contentView = stack
        add(stack, press, "Press") { [unowned self] in pressCount += 1; changed() }
        for label in ["Value", "Title", "Name", "Email", "City", "New item"] { addField(stack, label) }
        add(stack, NSButton(title: "Add", target: nil, action: nil), "Add") { [unowned self] in addItem() }
        add(stack, archived, "Archived") { changed() }
        let note = NSTextView(frame: NSRect(x: 0, y: 0, width: 600, height: 60))
        note.setAccessibilityLabel("Note")
        stack.addArrangedSubview(NSTextField(labelWithString: "Note"))
        stack.addArrangedSubview(note)
        fields.track("Note", note)
        scrollTarget.onChange = changed
        dragList.onChange = changed
        for view in [scrollTarget, dragList] as [NSView] {
            view.widthAnchor.constraint(equalToConstant: 600).isActive = true
            view.heightAnchor.constraint(equalToConstant: view.frame.height).isActive = true
            stack.addArrangedSubview(view)
        }
        rows.addItems(withTitles: (1...60).map { "Row \($0)" })
        rows.setAccessibilityLabel("Rows")
        stack.addArrangedSubview(rows)
        add(stack, NSButton(title: "Mark done", target: nil, action: nil), "Mark done") { [unowned self] in
            doneRow = rows.indexOfSelectedItem + 1
            changed()
        }
        saved = documentState()
    }

    private func add(_ stack: NSStackView, _ button: NSButton, _ label: String, _ handler: @escaping () -> Void) {
        button.setAccessibilityLabel(label)
        button.target = self
        button.action = #selector(clicked(_:))
        handlers[ObjectIdentifier(button)] = handler
        stack.addArrangedSubview(button)
    }

    @objc private func clicked(_ sender: NSButton) { handlers[ObjectIdentifier(sender)]?() }

    private func addField(_ stack: NSStackView, _ label: String) {
        let field = NSTextField(string: "")
        field.placeholderString = label
        field.setAccessibilityLabel(label)
        field.widthAnchor.constraint(equalToConstant: 600).isActive = true
        stack.addArrangedSubview(NSTextField(labelWithString: label))
        stack.addArrangedSubview(field)
        fields.track(label, field)
    }

    override func sendEvent(_ event: NSEvent) {
        let modifiers = event.modifierFlags.intersection([.control, .option, .command])
        if event.type == .keyDown, !modifiers.isEmpty, let key = event.charactersIgnoringModifiers?.lowercased() {
            let names: [(NSEvent.ModifierFlags, String)] = [(.control, "ctrl"), (.option, "alt"), (.shift, "shift"), (.command, "super")]
            chords.append((names.filter { event.modifierFlags.contains($0.0) }.map(\.1) + [key]).joined(separator: "+"))
            changed()
        }
        super.sendEvent(event)
    }

    func pokeChord() {
        guard let event = NSEvent.keyEvent(
            with: .keyDown, location: .zero, modifierFlags: .control, timestamp: 0, windowNumber: windowNumber,
            context: nil, characters: "\u{0B}", charactersIgnoringModifiers: "k", isARepeat: false, keyCode: 40) else { return }
        sendEvent(event)
    }

    private func addItem() {
        let text = fields.text("New item")
        if !text.isEmpty {
            items.append(text)
            fields.set("New item", "")
        }
        changed()
    }

    func save() {
        saved = documentState()
        savedOnce = true
        changed()
    }

    func rename() {
        let alert = NSAlert()
        alert.messageText = "Rename"
        let entry = NSTextField(frame: NSRect(x: 0, y: 0, width: 240, height: 24))
        entry.setAccessibilityLabel("New name")
        alert.accessoryView = entry
        alert.addButton(withTitle: "Rename")
        alert.beginSheetModal(for: self) { [unowned self] _ in
            if !entry.stringValue.isEmpty { documentName = entry.stringValue }
            changed()
        }
    }

    func documentState() -> [String: Any] {
        [
            "title": fields.text("Title"), "name": fields.text("Name"), "email": fields.text("Email"),
            "city": fields.text("City"), "archived": archived.state == .on, "priority": priority,
            "order": dragList.order.joined(separator: ","), "doneRow": doneRow, "note": fields.text("Note"),
            "documentName": documentName, "items": items.joined(separator: ","),
        ]
    }
}
