import AppKit

final class ScrollTarget: NSView {
    var steps = 0
    var onChange: () -> Void = {}

    override init(frame: NSRect) {
        super.init(frame: frame)
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityLabel("Scroll target")
        let label = NSTextField(labelWithString: "Scroll target")
        label.frame = NSRect(x: 4, y: 4, width: 200, height: 20)
        addSubview(label)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override func scrollWheel(with event: NSEvent) {
        let notches = event.hasPreciseScrollingDeltas ? event.scrollingDeltaY / 10 : event.scrollingDeltaY
        guard notches != 0 else { return }
        steps += notches < 0 ? 1 : -1
        onChange()
    }

    func pokeWheelDown(_ notches: Int) {
        for _ in 0..<notches {
            guard let cg = CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 1, wheel1: -1, wheel2: 0, wheel3: 0),
                  let event = NSEvent(cgEvent: cg) else { continue }
            scrollWheel(with: event)
        }
    }
}

final class DragList: NSView {
    private(set) var order = ["a", "b", "c"]
    var onChange: () -> Void = {}
    private var source: String?
    private let rowHeight: CGFloat = 20

    override var isFlipped: Bool { true }

    override init(frame: NSRect) {
        super.init(frame: frame)
        setAccessibilityElement(true)
        setAccessibilityRole(.list)
        setAccessibilityLabel("Order")
        render()
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    func rowY(_ item: String) -> CGFloat { CGFloat(order.firstIndex(of: item) ?? 0) * rowHeight }

    private func item(at y: CGFloat) -> String? {
        let index = Int(y / rowHeight)
        return order.indices.contains(index) ? order[index] : nil
    }

    override func mouseDown(with event: NSEvent) {
        source = item(at: convert(event.locationInWindow, from: nil).y)
    }

    override func mouseUp(with event: NSEvent) {
        let y = convert(event.locationInWindow, from: nil).y
        guard let dragged = source else { return }
        source = nil
        guard let target = item(at: y), target != dragged else { return }
        let top = rowY(target)
        var next = order.filter { $0 != dragged }
        var index = next.firstIndex(of: target) ?? 0
        if y >= top + rowHeight / 2 { index += 1 }
        next.insert(dragged, at: index)
        order = next
        render()
        onChange()
    }

    func pokeDrag(from: String, to: String) {
        guard let window else { return }
        for (type, item, dy) in [(NSEvent.EventType.leftMouseDown, from, 4.0), (.leftMouseUp, to, 1.0)] {
            let point = convert(NSPoint(x: 4, y: rowY(item) + dy), to: nil)
            guard let event = NSEvent.mouseEvent(
                with: type, location: point, modifierFlags: [], timestamp: 0, windowNumber: window.windowNumber,
                context: nil, eventNumber: 0, clickCount: 1, pressure: 1) else { continue }
            if type == .leftMouseDown { mouseDown(with: event) } else { mouseUp(with: event) }
        }
    }

    private func render() {
        subviews.forEach { $0.removeFromSuperview() }
        for (index, item) in order.enumerated() {
            let row = NSTextField(labelWithString: item)
            row.frame = NSRect(x: 4, y: CGFloat(index) * rowHeight, width: 200, height: rowHeight)
            row.setAccessibilityRole(.row)
            row.setAccessibilityLabel(item)
            addSubview(row)
        }
    }
}

final class TextFields: NSObject, NSTextFieldDelegate, NSTextViewDelegate {
    private let undoGroupSeconds = 1.0
    private var widgets: [String: NSView] = [:]
    private var lastText: [String: String] = [:]
    private var groups: [(String, String)] = []
    private var lastLabel: String?
    private var lastAt = Date.distantPast
    private var restoring = false
    let onChange: () -> Void

    init(onChange: @escaping () -> Void) { self.onChange = onChange }

    func track(_ label: String, _ widget: NSView) {
        widgets[label] = widget
        lastText[label] = text(label)
        if let field = widget as? NSTextField { field.delegate = self }
        if let view = widget as? NSTextView { view.delegate = self }
    }

    func widget(_ label: String) -> NSView? { widgets[label] }

    func text(_ label: String) -> String {
        switch widgets[label] {
        case let field as NSTextField: return field.stringValue
        case let view as NSTextView: return view.string
        default: return ""
        }
    }

    func set(_ label: String, _ value: String) {
        switch widgets[label] {
        case let field as NSTextField: field.stringValue = value
        case let view as NSTextView: view.string = value
        default: return
        }
        edited(label)
    }

    private func label(of object: Any?) -> String? {
        widgets.first { $0.value === object as AnyObject? }?.key
    }

    func controlTextDidChange(_ note: Notification) {
        if let label = label(of: note.object) { edited(label) }
    }

    func textDidChange(_ note: Notification) {
        if let label = label(of: note.object) { edited(label) }
    }

    private func edited(_ label: String) {
        if !restoring {
            let now = Date()
            if lastLabel != label || now.timeIntervalSince(lastAt) > undoGroupSeconds {
                groups.append((label, lastText[label] ?? ""))
            }
            lastLabel = label
            lastAt = now
        }
        lastText[label] = text(label)
        onChange()
    }

    func undo() {
        guard let (label, value) = groups.popLast() else { return }
        lastLabel = nil
        restoring = true
        defer { restoring = false }
        set(label, value)
    }
}
