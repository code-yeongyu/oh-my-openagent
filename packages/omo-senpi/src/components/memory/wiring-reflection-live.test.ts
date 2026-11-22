import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { loadedMemoryConfig, memorySettings } from "./memory.test-support"
import { fixture } from "./prompt.test-support"
import { createMemoryReflectionLiveWiring, createReflectionCompletionApi } from "./wiring-reflection-live"
import { recordReflectionCompletion } from "./worker/completion"
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

test("session bind warns once for three all-dropped completions that happened offline", async () => {
  const { repo, context } = await fixture()
  const dir = join(context.identityPaths.reflection, "completions")
  const now = Date.parse("2026-09-09T12:00:00.000Z")
  const sessionId = "reflection-recipient"
  for (const index of [1, 2, 3]) {
    const at = new Date(now - index * 1000).toISOString()
    await recordReflectionCompletion(dir, {
      schemaVersion: 1,
      runId: `offline-${index}`,
      identity: context.identity,
      category: "quick",
      conversationIds: [],
      trigger: "manual",
      outcome: "no_changes",
      droppedCount: 1,
      dropReason: "frontmatter",
      startedAt: at,
      finishedAt: at,
      delivery: { status: "pending" },
    })
  }
  const wiring = createMemoryReflectionLiveWiring(
    {
      sessions: new Map([[sessionId, { context }]]),
      loadConfig: () => loadedMemoryConfig(memorySettings()),
      cwd: () => repo.dir,
      env: {},
      now: () => now,
    },
    { current: sessionId },
    {},
  )
  const warnings: string[] = []
  const ui = {
    setStatus() {},
    notify(message: string, level: string) {
      if (level === "warning") warnings.push(message)
    },
  }
  const pi = createFakePi({})
  try {
    await wiring.bind(pi, sessionId, context, { ui }, () => {})
    await wiring.bind(pi, sessionId, context, { ui }, () => {})
    expect(warnings).toEqual(["Memory reflection dropped every entry in 3 runs in a row."])
  } finally {
    await wiring.settled()
    wiring.shutdown(context.identity)
  }
})

describe("createReflectionCompletionApi stale extension ctx guard (#7946)", () => {
  test("#given a pi retired by session replacement #when appendEntry is called #then the stale-ctx throw is swallowed", () => {
    // given a pi whose appendEntry throws the session-replacement stale guard message
    const api = createReflectionCompletionApi(
      createFakePi({
        appendEntry: () => {
          throw new Error(
            "This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload().",
          )
        },
      }),
    )
    expect(api).toBeDefined()

    // when / then: no throw escapes
    expect(() => api!.appendEntry("omo-memory:reflection-launched", { runId: "r1" })).not.toThrow()
  })

  test("#given a pi retired by runtime reload #when appendEntry is called #then the stale-generation throw is swallowed", () => {
    const api = createReflectionCompletionApi(
      createFakePi({
        appendEntry: () => {
          throw new Error("stale extension generation after reload")
        },
      }),
    )
    expect(api).toBeDefined()

    expect(() => api!.appendEntry("omo-memory:reflection-launched", { runId: "r2" })).not.toThrow()
  })

  test("#given a pi that throws a foreign error #when appendEntry is called #then the error still propagates", () => {
    const api = createReflectionCompletionApi(
      createFakePi({
        appendEntry: () => {
          throw new Error("disk full")
        },
      }),
    )

    expect(() => api!.appendEntry("omo-memory:reflection-launched", {})).toThrow("disk full")
  })

  test("#given a healthy pi #when appendEntry is called #then the entry passes through", () => {
    const written: Array<{ customType: string; data: unknown }> = []
    const api = createReflectionCompletionApi(
      createFakePi({
        appendEntry: (customType, data) => written.push({ customType, data }),
      }),
    )

    api!.appendEntry("omo-memory:reflection-launched", { runId: "r3" })

    expect(written).toEqual([{ customType: "omo-memory:reflection-launched", data: { runId: "r3" } }])
  })

  test("#given a stale pi #when registerEntryRenderer is called #then the throw is swallowed", () => {
    const api = createReflectionCompletionApi(
      createFakePi({
        registerEntryRenderer: () => {
          throw new Error("stale extension generation after reload")
        },
      }),
    )

    expect(() => api!.registerEntryRenderer("omo-memory:reflection-completed", () => undefined)).not.toThrow()
  })

  test("#given a pi without memory capabilities #when created #then undefined is returned", () => {
    expect(createReflectionCompletionApi({} as SenpiExtensionAPI)).toBeUndefined()
  })
})
