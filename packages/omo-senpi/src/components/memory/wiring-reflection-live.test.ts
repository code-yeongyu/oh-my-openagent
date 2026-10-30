import { describe, expect, test } from "bun:test"

import { createReflectionCompletionApi } from "./wiring-reflection-live"
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
