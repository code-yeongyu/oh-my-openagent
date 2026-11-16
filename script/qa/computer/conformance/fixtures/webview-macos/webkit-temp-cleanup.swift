import Darwin
import Foundation

/// WebKit's networking service keeps this app's folders in the per-user Darwin temp directory
/// ("com.apple.WebKit.Networking+Conformance Fixture..."), which no environment variable moves. At quit, after the web
/// views are torn down, the fixture waits for every networking process that still holds a file in those folders to
/// exit (a process-exit event, bounded), then removes them. Anything left is a typed failure, never a skip.
enum WebKitTempCleanup {
    enum Outcome {
        case clean
        case failed(String)
    }

    static func run(bound: TimeInterval) -> Outcome {
        let deadline = DispatchTime.now() + bound
        let folders = ownFolders()
        if folders.isEmpty { return .clean }
        for holder in holders(of: folders) where !waitForExit(holder, until: deadline) {
            return .failed("networking process \(holder) still holds \(folders.joined(separator: ", "))")
        }
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

    private static func holders(of folders: [String]) -> [pid_t] {
        let capacity = proc_listallpids(nil, 0)
        guard capacity > 0 else { return [] }
        var pids = [pid_t](repeating: 0, count: Int(capacity) * 2)
        let listed = proc_listallpids(&pids, Int32(pids.count * MemoryLayout<pid_t>.size))
        return pids.prefix(Int(max(listed, 0))).filter { $0 > 0 && isNetworking($0) && holdsAny($0, folders) }
    }

    private static func isNetworking(_ pid: pid_t) -> Bool {
        var buffer = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
        guard proc_pidpath(pid, &buffer, UInt32(buffer.count)) > 0 else { return false }
        return String(cString: buffer).contains("com.apple.WebKit.Networking")
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
