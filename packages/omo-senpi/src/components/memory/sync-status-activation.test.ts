import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"

import { createMemoryIdentityContext } from "./context"
import { loadedMemoryConfig, memorySettings, MemoryFakeExtensionAPI } from "./memory.test-support"
import { createMemoryReflectionLiveWiring } from "./wiring-reflection-live"

test("#given a background sync failure with no further transition #when the foreground session binds #then it gets the current failure once (#11059)", async () => {
  const root = await mkdtemp(join(tmpdir(), "omo-sync-activation-"))
  const identity = createMemoryIdentityContext({
    identity: "agent-test",
    identityPaths: buildIdentityPaths(root, "agent-test"),
    binding: { identity: "agent-test", repoPathHash: "hash", boundAt: 1 },
  })
  const notices: Array<{ message: string; level: string }> = []
  const eventCtx = {
    ui: {
      setStatus: () => {},
      notify: (message: string, level: string) => notices.push({ message, level }),
    },
  }
  const activeSession = { current: "other-session" }
  const wiring = createMemoryReflectionLiveWiring({
    sessions: new Map([["session-1", { context: identity }]]),
    loadConfig: () => loadedMemoryConfig(memorySettings()),
    cwd: () => root,
    env: {},
    syncStatus: async () => ({
      kind: "failing",
      since: 0,
      attempts: 3,
      failure: { kind: "offline", reason: "Cannot reach the service.", action: "Check your connection." },
    }),
  }, activeSession, { current: eventCtx })
  try {
    await wiring.onSyncStatusChanged(identity.identityPaths.repo)
    expect(notices).toEqual([])
    activeSession.current = "session-1"
    const pi = new MemoryFakeExtensionAPI()

    await wiring.bind(pi, "session-1", identity, eventCtx, () => {})
    await wiring.bind(pi, "session-1", identity, eventCtx, () => {})

    expect(notices).toEqual([
      { message: "Memory sync is blocked. Cannot reach the service. Check your connection.", level: "warning" },
    ])
  } finally {
    wiring.shutdown()
    await wiring.settled()
    await rm(root, { recursive: true, force: true })
  }
})
