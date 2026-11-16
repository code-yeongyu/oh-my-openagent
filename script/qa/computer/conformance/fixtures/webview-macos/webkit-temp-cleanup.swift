import Darwin
import Foundation

/// The responsibility lookup libSystem exports without a public header: the pid macOS holds responsible for `pid`,
/// which for the XPC services WebKit launches is the app that asked for them.
@_silgen_name("responsibility_get_pid_responsible_for_pid")
private func responsiblePid(_ pid: pid_t) -> pid_t

/// WebKit's helper services keep this app's folders in the per-user Darwin temp directory
/// ("com.apple.WebKit.Networking+Conformance Fixture..."), which no environment variable moves. At quit, after the web
/// views are torn down, the fixture waits for every WebKit helper (Networking, WebContent, GPU) that macOS counts as
/// this app's, and for any other WebKit process still holding a file in those folders, to exit (a process-exit event,
/// bounded); only then does it remove the folders, so no live helper of this app can recreate one after the removal.
/// Anything left is a typed failure, never a skip.
enum WebKitTempCleanup {
    enum Outcome {
        case clean
        case failed(String)
    }

    static func run(bound: TimeInterval) -> Outcome {
        let deadline = DispatchTime.now() + bound
        let seen = ownFolders()
        for helper in helpers(holding: seen) where !waitForExit(helper, until: deadline) {
            return .failed("WebKit helper \(helper) still runs; this app's folders: \(seen.joined(separator: ", "))")
        }
        let folders = ownFolders()
        if folders.isEmpty { return .clean }
        for folder in folders { try? FileManager.default.removeItem(atPath: folder) }
        let left = ownFolders()
        return left.isEmpty ? .clean : .failed("could not remove \(left.joined(separator: ", "))")
    }

    private static func ownFolders() -> [String] {
        let temp = realPath(NSTemporaryDirectory())
        let names = (try? FileManager.default.contentsOfDirectory(atPath: temp)) ?? []
        return names
            .filter { $0.hasPrefix("com.apple.WebKit.") && $0.contains("+Conformance Fixture") }
            .map { (temp as NSString).appendingPathComponent($0) }
    }

    private static func realPath(_ path: String) -> String {
        guard let resolved = realpath(path, nil) else { return path }
        defer { free(resolved) }
        return String(cString: resolved)
    }

    /// A WebKit helper is this app's when macOS names this process as responsible for it (the XPC services WebKit
    /// launches for this app); one that holds a file in this app's folders is waited for whoever is responsible.
    private static func helpers(holding folders: [String]) -> [pid_t] {
        let capacity = proc_listallpids(nil, 0)
        guard capacity > 0 else { return [] }
        var pids = [pid_t](repeating: 0, count: Int(capacity) * 2)
        let listed = proc_listallpids(&pids, Int32(pids.count * MemoryLayout<pid_t>.size))
        let own = getpid()
        return pids.prefix(Int(max(listed, 0))).filter { pid in
            pid > 0 && pid != own && isWebKitHelper(pid)
                && (responsiblePid(pid) == own || holdsAny(pid, folders))
        }
    }

    private static func isWebKitHelper(_ pid: pid_t) -> Bool {
        var buffer = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
        guard proc_pidpath(pid, &buffer, UInt32(buffer.count)) > 0 else { return false }
        return String(cString: buffer).contains("/com.apple.WebKit.")
    }

    private static func holdsAny(_ pid: pid_t, _ folders: [String]) -> Bool {
        let size = proc_pidinfo(pid, PROC_PIDLISTFDS, 0, nil, 0)
        guard size > 0 else { return false }
        let stride = MemoryLayout<proc_fdinfo>.stride
        var fds = [proc_fdinfo](repeating: proc_fdinfo(), count: Int(size) / stride)
        let filled = proc_pidinfo(pid, PROC_PIDLISTFDS, 0, &fds, size)
        for fd in fds.prefix(Int(max(filled, 0)) / stride) where fd.proc_fdtype == UInt32(PROX_FDTYPE_VNODE) {
            var info = vnode_fdinfowithpath()
            let read = proc_pidfdinfo(
                pid, fd.proc_fd, PROC_PIDFDVNODEPATHINFO, &info, Int32(MemoryLayout<vnode_fdinfowithpath>.size))
            guard read > 0 else { continue }
            let path = withUnsafeBytes(of: info.pvip.vip_path) { bytes in
                String(cString: bytes.bindMemory(to: CChar.self).baseAddress!)
            }
            if folders.contains(where: { path.hasPrefix($0) }) { return true }
        }
        return false
    }

    private static func waitForExit(_ pid: pid_t, until deadline: DispatchTime) -> Bool {
        let exited = DispatchSemaphore(value: 0)
        let source = DispatchSource.makeProcessSource(identifier: pid, eventMask: .exit, queue: .global())
        source.setEventHandler { exited.signal() }
        source.resume()
        defer { source.cancel() }
        if kill(pid, 0) != 0 { return true }
        return exited.wait(timeout: deadline) == .success
    }
}
