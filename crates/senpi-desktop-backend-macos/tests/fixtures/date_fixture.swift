// A one-window AppKit app with a real NSDatePicker, for the date live test.
// It orders its window in without activating; run it with TZ set to make the
// daylight-saving refusals deterministic on any host.
import AppKit

final class Delegate: NSObject, NSApplicationDelegate {
    var window: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let window = NSWindow(
            contentRect: NSRect(x: 260, y: 260, width: 360, height: 120),
            styleMask: [.titled],
            backing: .buffered,
            defer: false
        )
        window.title = CommandLine.arguments.dropFirst().first ?? "senpi-date-fixture"
        let picker = NSDatePicker(frame: NSRect(x: 20, y: 46, width: 260, height: 28))
        picker.datePickerStyle = .textFieldAndStepper
        picker.datePickerElements = [.yearMonthDay, .hourMinuteSecond]
        picker.dateValue = Date(timeIntervalSinceReferenceDate: 812_041_200)
        window.contentView?.addSubview(picker)
        window.orderFrontRegardless()
        self.window = window
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = Delegate()
app.delegate = delegate
app.run()
