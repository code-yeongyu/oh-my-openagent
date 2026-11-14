// Window-observer registration for the recorder (recorder.swift): every app the dialog detector must watch, from the
// moment the recorder arms, when an app launches, and when an app activates.

import AppKit
import ApplicationServices

extension Recorder {
  // A just-launched app often refuses registration until its AX server is up. It is retried for up to 2 s while its
  // activation policy is regular or not yet decided (.prohibited, which a launching app can still leave); a
  // background agent (.accessory) is tried once. An app already running when the recorder arms (origin "arm") is past
  // its launch and is tried once too, so a crowd of refusing background agents runs no retry chains on the main thread
  // into the sampler's tick gap. The policy is re-read at every attempt.
  //
  // Every gap is reported with the moment it began (`since`): a registration that came late as observer_late, one that
  // never came as observer_failed. An app that failed while not regular keeps that moment in `failedSince`; when it
  // activates it is registered again with that `since`, and the success is reported as observer_late even on its
  // first attempt, so the gap between failing and registering is judged (observer-gaps.ts). A registration still being
  // retried is counted in `registering`, which `stop` waits for and reports. An app that has quit is not reported.
  func watchWindows(of pid: pid_t, origin: String, attempt: Int = 1, since: Double = uptimeMs()) {
    if attempt == 1 && registering.contains(pid) { return }
    let error = observe(pid, AXUIElementCreateApplication(pid), [kAXWindowCreatedNotification, kAXSheetCreatedNotification])
    guard let app = NSRunningApplication(processIdentifier: pid), !app.isTerminated else {
      registering.remove(pid)
      return
    }
    let regular = app.activationPolicy == .regular
    if error == .success {
      registered.insert(pid)
      registering.remove(pid)
      let wasFailed = failedSince.removeValue(forKey: pid) != nil
      if attempt > 1 || wasFailed {
        emit([
          "kind": "observer_late", "origin": origin, "pid": Int(pid), "attempts": attempt, "regular": regular,
          "since": since,
        ])
      }
      return
    }
    if origin != "arm" && app.activationPolicy != .accessory && attempt < 10 {
      registering.insert(pid)
      return after(0.2) { self.watchWindows(of: pid, origin: origin, attempt: attempt + 1, since: since) }
    }
    registering.remove(pid)
    if !regular && failedSince[pid] == nil { failedSince[pid] = since }
    emit([
      "kind": "observer_failed", "origin": origin, "pid": Int(pid),
      "app": app.bundleIdentifier ?? app.localizedName ?? "unknown", "policy": policyName(app.activationPolicy),
      "axError": axErrorName(error), "attempts": attempt, "regular": regular, "since": since,
    ])
  }

  @objc func activated(_ note: Notification) {
    let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
    send("activation", ["kind": "activation", "via": "notification", "pid": Int(app?.processIdentifier ?? -1)])
    // An app that failed registration as a background agent and turned regular since gets its window observer now,
    // with its gap carried from the failure.
    if let pid = app?.processIdentifier, !registered.contains(pid) {
      watchWindows(of: pid, origin: "activation", since: failedSince[pid] ?? uptimeMs())
    }
  }

  @objc func launched(_ note: Notification) {
    if let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication {
      watchWindows(of: app.processIdentifier, origin: "launch")
    }
  }
}
