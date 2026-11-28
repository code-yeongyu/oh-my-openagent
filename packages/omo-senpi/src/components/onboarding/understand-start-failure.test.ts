// #15358: a model whose facts child cannot start fails its step, retries once, and falls back to scan-only. The desktop
// shows each step_failed reason, and a provider's error text can quote the request or a key fragment, so the reason
// names the failure kind only.
import { afterEach, describe, expect, test } from "bun:test"
import { join } from "node:path"

import { digest, runUnderstanding, tempRoot } from "./understand.test-support"

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

describe("onboarding understanding with a model that cannot start (#15358)", () => {
  test("#given a model provider that cannot start #when understanding runs #then the retry and fallback hold and each failure names its kind only", async () => {
    // given
    const root = await tempRoot("omo-understand-start-failure-")
    cleanups.push(root.cleanup)

    // when
    const { done, events, starts } = await runUnderstanding({
      digests: [digest(join(root.path, "a"), 1), digest(join(root.path, "a"), 2)],
      turn: async () => "throw",
    })

    // then
    expect(starts).toHaveLength(2)
    expect(done.fallback).toBe("scan_only")
    expect(events.filter((event) => event.kind === "step_failed").map((event) => event.reason)).toEqual([
      "the model call could not start: an unexpected error",
      "the model call could not start: an unexpected error",
    ])
  })
})
