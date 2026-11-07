import { describe, expect, test } from "bun:test"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"

import { createMemoryIdentityContext, type MemoryIdentityContext } from "./context"
import { loadedMemoryConfig, memorySettings } from "./memory.test-support"
import { formatMemoryStatusLine, MEMORY_STATUS_KEY, type GitRepoForStatus } from "./status"
import { createMemoryReflectionLiveWiring, createReflectionCompletionApi } from "./wiring-reflection-live"
import type { MemorySessionStateLike } from "./wiring-types"
import type { SenpiExtensionAPI } from "../../extension/types"

function createFakePi(overrides: {
  appendEntry?: (customType: string, data?: unknown) => void
  registerEntryRenderer?: (customType: string, renderer: unknown) => void
}): SenpiExtensionAPI {
  return {
    appendEntry: overrides.appendEntry ?? (() => undefined),
    registerEntryRenderer: overrides.registerEntryRenderer ?? (() => undefined),
  } as unknown as SenpiExtensionAPI
}

describe("createReflectionCompletionApi stale extension ctx guard (#7946)", () => {
  test("#given a pi retired by session replacement #when appendEntry is called #then the stale-ctx throw is swallowed", () => {
    // given a pi whose appendEntry throws the session-replacement stale guard message
    const api = createReflectionCompletionApi(createFakePi({
      appendEntry: () => {
        throw new Error(
          "This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload().",
        )
      },
    }))
    expect(api).toBeDefined()

    // when / then: no throw escapes
    expect(() => api!.appendEntry("omo-memory:reflection-launched", { runId: "r1" })).not.toThrow()
  })

  test("#given a pi retired by runtime reload #when appendEntry is called #then the stale-generation throw is swallowed", () => {
    const api = createReflectionCompletionApi(createFakePi({
      appendEntry: () => {
        throw new Error("stale extension generation after reload")
      },
    }))
    expect(api).toBeDefined()

    expect(() => api!.appendEntry("omo-memory:reflection-launched", { runId: "r2" })).not.toThrow()
  })

  test("#given a pi that throws a foreign error #when appendEntry is called #then the error still propagates", () => {
    const api = createReflectionCompletionApi(createFakePi({
      appendEntry: () => {
        throw new Error("disk full")
      },
    }))

    expect(() => api!.appendEntry("omo-memory:reflection-launched", {})).toThrow("disk full")
  })

  test("#given a healthy pi #when appendEntry is called #then the entry passes through", () => {
    const written: Array<{ customType: string; data: unknown }> = []
    const api = createReflectionCompletionApi(createFakePi({
      appendEntry: (customType, data) => written.push({ customType, data }),
    }))

    api!.appendEntry("omo-memory:reflection-launched", { runId: "r3" })

    expect(written).toEqual([{ customType: "omo-memory:reflection-launched", data: { runId: "r3" } }])
  })

  test("#given a stale pi #when registerEntryRenderer is called #then the throw is swallowed", () => {
    const api = createReflectionCompletionApi(createFakePi({
      registerEntryRenderer: () => {
        throw new Error("stale extension generation after reload")
      },
    }))

    expect(() => api!.registerEntryRenderer("omo-memory:reflection-completed", () => undefined)).not.toThrow()
  })

  test("#given a pi without memory capabilities #when created #then undefined is returned", () => {
    expect(createReflectionCompletionApi({} as SenpiExtensionAPI)).toBeUndefined()
  })
})

describe("bind-time memory footer publish ownership (#12253)", () => {
  const NOW_MS = 2_000_000_000
  const COMMITTED_AT_SEC = (NOW_MS - 60_000) / 1000
  const IDENTITY = "bind-owner-agent"

  const expectedText = formatMemoryStatusLine(IDENTITY, "1m ago", {
    dirty: false,
    backlogSteps: 0,
    streak: 0,
    parked: false,
  })

  function statusRecorder(): {
    readonly calls: Array<{ key: string; text: string | undefined }>
    readonly eventCtx: unknown
  } {
    const calls: Array<{ key: string; text: string | undefined }> = []
    return {
      calls,
      eventCtx: {
        sessionManager: { getSessionId: () => "session-bind" },
        ui: {
          setStatus: (key: string, text: string | undefined) => calls.push({ key, text }),
          notify: () => {},
        },
      },
    }
  }

  function identity(): MemoryIdentityContext {
    return createMemoryIdentityContext({
      identity: IDENTITY,
      identityPaths: buildIdentityPaths("/tmp/bind-owner-root", IDENTITY),
      binding: { identity: IDENTITY, repoPathHash: "hash", boundAt: 1 },
    })
  }

  function fastRepo(head: string | null = "head-sha-1", committedAtSec: number | null = COMMITTED_AT_SEC): GitRepoForStatus {
    return {
      head: async () => head,
      headCommitTimestamp: async () => committedAtSec,
      lsTree: async () => [],
      show: async () => "",
      status: async () => "",
    }
  }

  function gatedHeadRepo(gate: Promise<void>): GitRepoForStatus {
    return {
      head: async () => {
        await gate
        return "head-sha-1"
      },
      headCommitTimestamp: async () => COMMITTED_AT_SEC,
      lsTree: async () => [],
      show: async () => "",
      status: async () => "",
    }
  }

  function wiring(bindTarget: MemoryIdentityContext, createGitRepo: (repoPath: string) => GitRepoForStatus): ReturnType<typeof createMemoryReflectionLiveWiring> {
    return createMemoryReflectionLiveWiring({
      sessions: new Map([["session-bind", { context: bindTarget }]]),
      loadConfig: () => loadedMemoryConfig(memorySettings()),
      cwd: () => "/tmp/bind-owner-root",
      env: {},
      now: () => NOW_MS,
      createGitRepo,
    }, { current: "session-bind" }, { current: undefined })
  }

  test("#given the initial-status git reads finish after the footer refresh #when the bind settles #then exactly one footer line is published", async () => {
    const { calls, eventCtx } = statusRecorder()
    const gate = Promise.withResolvers<void>()
    const repos: GitRepoForStatus[] = []
    const bindTarget = identity()
    const w = wiring(bindTarget, () => {
      const repo = repos.length === 0 ? gatedHeadRepo(gate.promise) : fastRepo()
      repos.push(repo)
      return repo
    })

    const bindCompletion = w.bind(createFakePi({}), "session-bind", bindTarget, eventCtx, () => {})
    await bindCompletion
    expect(calls).toEqual([{ key: MEMORY_STATUS_KEY, text: expectedText }])

    gate.resolve()
    await w.settled()
    expect(calls).toEqual([{ key: MEMORY_STATUS_KEY, text: expectedText }])
  })

  test("#given the initial-status git reads finish first #when the bind settles #then the same single footer line is published", async () => {
    const { calls, eventCtx } = statusRecorder()
    const bindTarget = identity()
    const w = wiring(bindTarget, () => fastRepo())

    await w.bind(createFakePi({}), "session-bind", bindTarget, eventCtx, () => {})
    await w.settled()
    expect(calls).toEqual([{ key: MEMORY_STATUS_KEY, text: expectedText }])
  })

  test("#given an unreadable head or an unresolvable commit age #when the bind settles #then no footer line is published", async () => {
    for (const repo of [fastRepo(null), fastRepo("head-sha-1", null)]) {
      const { calls, eventCtx } = statusRecorder()
      const bindTarget = identity()
      const w = wiring(bindTarget, () => repo)

      await w.bind(createFakePi({}), "session-bind", bindTarget, eventCtx, () => {})
      await w.settled()
      expect(calls).toEqual([])
    }
  })
})

describe("bind-time memory footer across sessions (#12270)", () => {
  const NOW_MS = 2_000_000_000
  const COMMITTED_AT_SEC = (NOW_MS - 60_000) / 1000
  const NO_SEGMENTS = { dirty: false, backlogSteps: 0, streak: 0, parked: false }

  function sessionRecorder(sessionId: string) {
    const calls: Array<{ key: string; text: string | undefined }> = []
    return {
      calls,
      eventCtx: {
        sessionManager: { getSessionId: () => sessionId },
        ui: {
          setStatus: (key: string, text: string | undefined) => calls.push({ key, text }),
          notify: () => {},
        },
      },
    }
  }

  function identityFor(agent: string): MemoryIdentityContext {
    return createMemoryIdentityContext({
      identity: agent,
      identityPaths: buildIdentityPaths("/tmp/bind-owner-root", agent),
      binding: { identity: agent, repoPathHash: "hash", boundAt: 1 },
    })
  }

  function sameStateRepo(): GitRepoForStatus {
    return {
      head: async () => "head-sha-1",
      headCommitTimestamp: async () => COMMITTED_AT_SEC,
      lsTree: async () => [],
      show: async () => "",
      status: async () => "",
    }
  }

  function twoSessionWiring(sessions: Map<string, MemorySessionStateLike>): ReturnType<typeof createMemoryReflectionLiveWiring> {
    return createMemoryReflectionLiveWiring({
      sessions,
      loadConfig: () => loadedMemoryConfig(memorySettings()),
      cwd: () => "/tmp/bind-owner-root",
      env: {},
      now: () => NOW_MS,
      createGitRepo: () => sameStateRepo(),
    }, { current: undefined }, { current: undefined })
  }

  test("#given a first session published its footer #when a second session binds to the same git state #then the second session publishes its own footer too", async () => {
    const first = sessionRecorder("session-a")
    const second = sessionRecorder("session-b")
    const firstIdentity = identityFor("agent-a")
    const secondIdentity = identityFor("agent-b")
    const w = twoSessionWiring(new Map<string, MemorySessionStateLike>([
      ["session-a", { context: firstIdentity }],
      ["session-b", { context: secondIdentity }],
    ]))

    await w.bind(createFakePi({}), "session-a", firstIdentity, first.eventCtx, () => {})
    await w.settled()
    await w.bind(createFakePi({}), "session-b", secondIdentity, second.eventCtx, () => {})
    await w.settled()

    expect(first.calls).toEqual([
      { key: MEMORY_STATUS_KEY, text: formatMemoryStatusLine("agent-a", "1m ago", NO_SEGMENTS) },
    ])
    expect(second.calls).toEqual([
      { key: MEMORY_STATUS_KEY, text: formatMemoryStatusLine("agent-b", "1m ago", NO_SEGMENTS) },
    ])
  })
})
