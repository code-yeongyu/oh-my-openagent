import { afterEach, describe, expect, test } from "bun:test"

import { readFileSync } from "node:fs"

import { createCallerSettingsWorld, PROVIDER, type CallerSettingsWorld } from "./__fixtures__/caller-settings-world"
import { InProcessRunner } from "./in-process"

// The configured stream-start guard is tiny; the engine default is 300 s. A guard that has not fired
// this long after the request was sent is the default one, so the test fails here instead of hanging.
const DEFAULT_GUARD_EVIDENCE_MS = 10_000

let world: CallerSettingsWorld | undefined
afterEach(() => {
  world?.dispose()
  world = undefined
})

async function abortReasonWithin(aborted: Promise<string>, ms: number): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const notFired = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve(`no stream-start abort within ${ms}ms`), ms)
  })
  try {
    return await Promise.race([aborted, notFired])
  } finally {
    clearTimeout(timer)
  }
}

describe("in-process child honors the caller's settings", () => {
  test("#given the caller raised httpIdleTimeoutMs and set a short streamStartTimeoutMs #when a child's provider never sends a first event #then the child's request is cut at the configured start guard and carries the configured idle timeout", async () => {
    // given
    world = await createCallerSettingsWorld(
      { httpIdleTimeoutMs: 660_000, retry: { provider: { streamStartTimeoutMs: 150, maxRetries: 0 } } },
      { silent: "hang" },
    )
    const handle = await new InProcessRunner().start(world.spec())

    // when
    const request = await world.firstCall
    const abortReason = await abortReasonWithin(request.aborted, DEFAULT_GUARD_EVIDENCE_MS)
    await handle.abort()
    handle.dispose()

    // then
    expect(abortReason).toContain("Provider stream start timed out after 150ms")
    expect(request.timeoutMs).toBe(660_000)
  }, 30_000)

  test("#given the caller set only httpIdleTimeoutMs #when a child sends a request #then the request carries the caller's idle timeout instead of the 300 s default", async () => {
    // given
    world = await createCallerSettingsWorld({ httpIdleTimeoutMs: 420_000 }, { primary: "complete" })
    const handle = await new InProcessRunner().start(world.spec())

    // when
    const outcome = await handle.waitForIdle()
    handle.dispose()

    // then
    expect(outcome).toMatchObject({ status: "completed", finalResponse: "primary completed" })
    expect(world.calls.map((call) => call.timeoutMs)).toEqual([420_000])
  }, 30_000)

  test("#given the caller has a global fallback chain for the child's model #when a child without its own chain hits a quota error #then it never switches to the caller's fallback model", async () => {
    // given
    world = await createCallerSettingsWorld(
      { retry: { modelFallback: true, fallbackChains: { [`${PROVIDER}/primary`]: [`${PROVIDER}/global-fallback`] } } },
      { primary: "quota", "global-fallback": "complete" },
    )
    const handle = await new InProcessRunner().start(world.spec({ retry: { maxRetries: 0 } }))

    // when
    const outcome = await handle.waitForIdle()
    handle.dispose()

    // then
    expect(outcome.status).toBe("error")
    expect(world.calls.map((call) => call.modelId)).not.toContain("global-fallback")
  }, 30_000)

  test("#given the caller has a global fallback chain and the child has its own #when the child hits a quota error #then it falls back to its own model only", async () => {
    // given
    world = await createCallerSettingsWorld(
      { retry: { modelFallback: true, fallbackChains: { [`${PROVIDER}/primary`]: [`${PROVIDER}/global-fallback`] } } },
      { primary: "quota", "own-fallback": "complete", "global-fallback": "complete" },
    )
    const ownFallback = { source: "category" as const, provider: PROVIDER, model_id: "own-fallback", display: `${PROVIDER}/own-fallback` }
    const handle = await new InProcessRunner().start(world.spec({
      selectedModel: `${PROVIDER}/primary`,
      fallbackModels: [ownFallback],
      retry: { maxRetries: 0 },
    }))

    // when
    const outcome = await handle.waitForIdle()
    handle.dispose()

    // then
    expect(outcome).toMatchObject({ status: "completed", finalResponse: "own-fallback completed" })
    expect(world.calls.map((call) => call.modelId)).toEqual(["primary", "own-fallback"])
  }, 30_000)

  test("#given a child ran to completion under the caller's settings #when the run is over #then the caller's settings file is byte-identical", async () => {
    // given
    world = await createCallerSettingsWorld(
      { httpIdleTimeoutMs: 660_000, retry: { modelFallback: true, fallbackChains: { [`${PROVIDER}/primary`]: [`${PROVIDER}/own-fallback`] } } },
      { primary: "quota", "own-fallback": "complete" },
    )
    const before = readFileSync(world.settingsPath, "utf8")
    const ownFallback = { source: "category" as const, provider: PROVIDER, model_id: "own-fallback", display: `${PROVIDER}/own-fallback` }

    // when
    const handle = await new InProcessRunner().start(world.spec({
      selectedModel: `${PROVIDER}/primary`,
      fallbackModels: [ownFallback],
      retry: { maxRetries: 0 },
    }))
    await handle.waitForIdle()
    handle.dispose()

    // then
    expect(readFileSync(world.settingsPath, "utf8")).toBe(before)
  }, 30_000)
})
