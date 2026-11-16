import Darwin
import Foundation

/// The responsibility lookup libSystem exports without a public header, called through dlsym as a C function: the pid
/// macOS holds responsible for a process. nil when this macOS does not export it.
private let responsibleFor: ((pid_t) -> pid_t)? = {
    // RTLD_DEFAULT is ((void *)-2) on Darwin; the C macro is not imported into Swift.
    guard let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "responsibility_get_pid_responsible_for_pid")
    else { return nil }
    let call = unsafeBitCast(symbol, to: (@convention(c) (pid_t) -> pid_t).self)
    return { call($0) }
}()

/// WebKit's helper services keep this app's folders in the per-user Darwin temp directory
/// ("com.apple.WebKit.Networking+Conformance Fixture..."), which no environment variable moves. At quit, after the web
/// views are torn down, the fixture waits for every WebKit helper (Networking, WebContent, GPU) of its own, and for any
/// other WebKit process still holding a file in those folders, to exit (a process-exit event, bounded). It scans again
/// until a scan finds none, so a helper WebKit starts during the teardown is waited for too, and only then removes the
/// folders: no live helper of this app is left to recreate one. Anything left is a typed failure, never a skip.
enum WebKitTempCleanup {
    enum Outcome {
        /// How many helpers it waited for: this fixture's own, and others that only held a file in its folders.
        case clean(owned: Int, holders: Int)
        case failed(String)
    }

    /// `startTimeOf` reads a process's start time; cleanup-check/main.swift passes one that cannot.
    static func run(bound: TimeInterval, startTimeOf: @escaping (pid_t) -> timeval? = WebKitTempCleanup.startTime) -> Outcome {
        guard let responsibleFor else {
            return .failed("this macOS does not export responsibility_get_pid_responsible_for_pid")
        }
        let deadline = DispatchTime.now() + bound
        // Without the fixture's own start time every WebKit helper under its responsible process would count as its
        // own; fail closed (wait for nothing, delete nothing) instead of guessing.
        guard let owner = Owner(fixture: getpid(), responsibleFor: responsibleFor, startTimeOf: startTimeOf) else {
            return .failed("cannot read this fixture's start time; deleted nothing")
        }
        var owned = Set<pid_t>()
        var holders = Set<pid_t>()
        while true {
            let seen = ownFolders()
            let live = helpers(of: owner, holding: seen)
            if live.isEmpty { break }
            if DispatchTime.now() >= deadline {
                return .failed("WebKit helpers \(live) were still starting at the bound")
            }
            for helper in live {
                if owner.owns(helper) { owned.insert(helper) } else { holders.insert(helper) }
                if !waitForExit(helper, until: deadline) {
                    return .failed("WebKit helper \(helper) still runs; this app's folders: \(seen.joined(separator: ", "))")
                }
            }
        }
        let folders = ownFolders()
        for folder in folders { try? FileManager.default.removeItem(atPath: folder) }
        let left = ownFolders()
        if !left.isEmpty { return .failed("could not remove \(left.joined(separator: ", "))") }
        return .clean(owned: owned.count, holders: holders.count)
    }

    /// Whose WebKit helpers are this fixture's. Launched through LaunchServices the fixture is responsible for its own
    /// helpers; started directly (the self-test spawns the binary) it and its helpers share its spawner's responsible
    /// process, so a helper with that responsible process counts only if it started after the fixture did.
    private struct Owner {
        let fixture: pid_t
        let responsible: pid_t
        let started: timeval
        let responsibleFor: (pid_t) -> pid_t
        let startTimeOf: (pid_t) -> timeval?

        init?(
            fixture: pid_t, responsibleFor: @escaping (pid_t) -> pid_t,
            startTimeOf: @escaping (pid_t) -> timeval?
        ) {
            guard let started = startTimeOf(fixture) else { return nil }
            self.fixture = fixture
            self.responsible = responsibleFor(fixture)
            self.started = started
            self.responsibleFor = responsibleFor
            self.startTimeOf = startTimeOf
        }

        func owns(_ pid: pid_t) -> Bool {
            let responsible = responsibleFor(pid)
            if responsible == fixture { return true }
            guard responsible == self.responsible, let started = startTimeOf(pid) else { return false }
            return (started.tv_sec, started.tv_usec) >= (self.started.tv_sec, self.started.tv_usec)
        }
    }

    static func startTime(_ pid: pid_t) -> timeval? {
        var info = proc_bsdinfo()
        let size = Int32(MemoryLayout<proc_bsdinfo>.size)
        guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size else { return nil }
        return timeval(tv_sec: Int(info.pbi_start_tvsec), tv_usec: Int32(info.pbi_start_tvusec))
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

    /// This fixture's WebKit helpers (see Owner), and any WebKit process holding a file in this app's folders.
    private static func helpers(of owner: Owner, holding folders: [String]) -> [pid_t] {
        let capacity = proc_listallpids(nil, 0)
        guard capacity > 0 else { return [] }
        var pids = [pid_t](repeating: 0, count: Int(capacity) * 2)
        let listed = proc_listallpids(&pids, Int32(pids.count * MemoryLayout<pid_t>.size))
        return pids.prefix(Int(max(listed, 0))).filter { pid in
            pid > 0 && pid != owner.fixture && isWebKitHelper(pid) && (owner.owns(pid) || holdsAny(pid, folders))
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
