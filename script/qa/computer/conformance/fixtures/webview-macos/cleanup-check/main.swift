import Foundation

// Proves WebKitTempCleanup fails closed when it cannot read the fixture's start time: it must report a failure and
// leave this app's temp folders alone. Runs only with TMPDIR set to a fresh scratch directory whose path contains
// "cleanup-check", so it can never touch a real user's temp folders.
let temp = NSTemporaryDirectory()
guard temp.contains("cleanup-check") else {
    print("CLEANUP_CHECK refused: TMPDIR \(temp) is not a cleanup-check scratch directory")
    exit(2)
}
let folder = (temp as NSString).appendingPathComponent("com.apple.WebKit.Networking+Conformance Fixture.check")
do {
    try FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
} catch {
    print("CLEANUP_CHECK refused: cannot create \(folder): \(error)")
    exit(2)
}
let outcome = WebKitTempCleanup.run(bound: 1, startTimeOf: { _ in nil })
let kept = FileManager.default.fileExists(atPath: folder)
switch outcome {
case .failed(let reason) where kept:
    print("CLEANUP_CHECK pass: failed closed (\(reason)), folder kept")
    exit(0)
default:
    print("CLEANUP_CHECK FAIL: outcome \(outcome), folder kept: \(kept)")
    exit(1)
}
