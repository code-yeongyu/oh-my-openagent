import Foundation

// Proves WebKitTempCleanup fails closed when it cannot read the fixture's start time: it must report that failure and
// leave this app's temp folders alone. It works only in the scratch directory given as its one argument, whose path
// must contain "cleanup-check", so it can never touch a real user's temp folders.
guard CommandLine.arguments.count == 2, CommandLine.arguments[1].contains("cleanup-check") else {
    print("CLEANUP_CHECK refused: usage: cleanup-check <scratch directory whose path contains cleanup-check>")
    exit(2)
}
let temp = CommandLine.arguments[1]
let folder = (temp as NSString).appendingPathComponent("com.apple.WebKit.Networking+Conformance Fixture.check")
do {
    try FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
} catch {
    print("CLEANUP_CHECK refused: cannot create \(folder): \(error)")
    exit(2)
}
let outcome = WebKitTempCleanup.run(bound: 1, startTimeOf: { _ in nil }, temporaryDirectory: temp)
let kept = FileManager.default.fileExists(atPath: folder)
// Only the start-time branch may pass: any other failure (for example a missing responsibility lookup) is not this proof.
let startTimeFailure = "cannot read this fixture's start time; deleted nothing"
switch outcome {
case .failed(let reason) where kept && reason == startTimeFailure:
    print("CLEANUP_CHECK pass: failed closed (\(reason)), folder kept")
    exit(0)
default:
    print("CLEANUP_CHECK FAIL: outcome \(outcome), folder kept: \(kept)")
    exit(1)
}
