import { expect, test } from "bun:test"

import type { EngineStatus } from "@oh-my-opencode/memory-core/sync-engine"

import { SYNC_RECOVERED_NOTICE, createSyncStatusNotifier, deliverSyncStatusChange } from "./sync-status-surface"

const failing = (kind: "offline" | "auth_expired", reason: string, action: string): EngineStatus => ({
  kind: "failing",
  since: 0,
  attempts: 3,
  failure: { kind, reason, action },
})

test("#given a failure starts in the background #when its repo becomes active #then its unseen failure is announced once (#11059)", async () => {
  const notices: Array<{ message: string; level: string }> = []
  const notifier = createSyncStatusNotifier(async () => failing("offline", "Cannot reach the service.", "Check your connection."))
  const ui = { notify: (message: string, level: "info" | "warning" | "error") => notices.push({ message, level }) }
  await deliverSyncStatusChange({
    repo: "/repo", isActiveRepo: false, notifier, ui,
    refreshFooter: () => {}, pushRpc: async () => {},
  })
  expect(notices).toEqual([])

  await notifier.changed("/repo", ui)
  await notifier.changed("/repo", ui)

  expect(notices).toEqual([
    { message: "Memory sync is blocked. Cannot reach the service. Check your connection.", level: "warning" },
  ])
})

test("#given sync transitions #when the notifier hears them #then the person gets one notice per failure kind with its reason and action, and one on recovery (omo #10637)", async () => {
  let status: EngineStatus | null = { kind: "synced", at: 1, updatedWhileOffline: 0 }
  const notices: Array<{ message: string; level: string }> = []
  const ui = { notify: (message: string, level: "info" | "warning" | "error") => notices.push({ message, level }) }
  const notifier = createSyncStatusNotifier(async () => status)

  await notifier.changed("/repo", ui)
  expect(notices).toEqual([])

  status = failing("offline", "Cannot reach the service.", "Check your connection.")
  await notifier.changed("/repo", ui)
  await notifier.changed("/repo", ui)
  status = failing("auth_expired", "Sign-in expired.", "Sign in to OmO again.")
  await notifier.changed("/repo", ui)
  status = { kind: "synced", at: 2, updatedWhileOffline: 0 }
  await notifier.changed("/repo", ui)
  await notifier.changed("/repo", ui)

  expect(notices).toEqual([
    { message: "Memory sync is blocked. Cannot reach the service. Check your connection.", level: "warning" },
    { message: "Memory sync is blocked. Sign-in expired. Sign in to OmO again.", level: "warning" },
    { message: SYNC_RECOVERED_NOTICE, level: "info" },
  ])
})

test("#given a stranded lock that moves to another path #when the notifier hears it #then the person gets a new notice naming the new path (omo #10637 review L1)", async () => {
  const lockAt = (path: string): EngineStatus => ({
    kind: "failing",
    since: 0,
    attempts: 1,
    failure: { kind: "stranded_lock", paths: [path], reason: "A git lock blocks sync.", action: `Run /memory unlock ${path}.` },
  })
  let status: EngineStatus = lockAt("/m/.git/index.lock")
  const notices: string[] = []
  const notifier = createSyncStatusNotifier(async () => status)
  const ui = { notify: (message: string) => notices.push(message) }
  await notifier.changed("/repo", ui)
  status = lockAt("/m/.git/HEAD.lock")
  await notifier.changed("/repo", ui)
  await notifier.changed("/repo", ui)
  expect(notices).toEqual([
    "Memory sync is blocked. A git lock blocks sync. Run /memory unlock /m/.git/index.lock.",
    "Memory sync is blocked. A git lock blocks sync. Run /memory unlock /m/.git/HEAD.lock.",
  ])
})

test("#given a status read that rejects #when the notifier hears a change #then it settles without a notice and the next good read still announces (omo #10637 review of #10960, LOW 3)", async () => {
  let fail = true
  const notices: string[] = []
  const notifier = createSyncStatusNotifier(async () => {
    if (fail) throw new Error("runner gone")
    return failing("offline", "The sync service cannot be reached.", "Check your connection.")
  })
  const ui = { notify: (message: string) => notices.push(message) }

  await notifier.changed("/repo", ui)
  expect(notices).toEqual([])

  fail = false
  await notifier.changed("/repo", ui)
  expect(notices).toEqual(["Memory sync is blocked. The sync service cannot be reached. Check your connection."])
})

test("#given sync recovers while another session is active #when the repo goes offline again #then the person still gets a new notice (omo #10637 review of #10958, LOW 1)", async () => {
  let status: EngineStatus = failing("offline", "The sync service cannot be reached.", "Check your connection.")
  const notices: string[] = []
  const notifier = createSyncStatusNotifier(async () => status)
  const ui = { notify: (message: string) => notices.push(message) }
  const deliver = (active: boolean) =>
    deliverSyncStatusChange({ repo: "/repo", isActiveRepo: active, notifier, ui, refreshFooter: () => {}, pushRpc: async () => {} })

  await deliver(true)
  status = { kind: "synced", at: 1, updatedWhileOffline: 0 }
  await deliver(false)
  status = failing("offline", "The sync service cannot be reached.", "Check your connection.")
  await deliver(true)

  expect(notices).toEqual([
    "Memory sync is blocked. The sync service cannot be reached. Check your connection.",
    "Memory sync is blocked. The sync service cannot be reached. Check your connection.",
  ])
})

test("#given a change for the active repo #when it is delivered #then the footer refreshes and the desktop push runs, and a non-active repo does neither (omo #10637 review of #10958 LOW 2, #10960 LOW 3)", async () => {
  const calls: string[] = []
  const notifier = createSyncStatusNotifier(async () => {
    throw new Error("runner gone")
  })
  const deliver = (active: boolean) =>
    deliverSyncStatusChange({
      repo: "/repo",
      isActiveRepo: active,
      notifier,
      ui: { notify: () => calls.push("notice") },
      refreshFooter: () => calls.push("footer"),
      pushRpc: async () => {
        calls.push("rpc")
      },
    })

  await deliver(false)
  expect(calls).toEqual([])
  await deliver(true)
  expect(calls).toEqual(["footer", "rpc"])
})
