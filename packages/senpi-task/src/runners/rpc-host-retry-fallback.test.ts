import { afterEach, describe, expect, test } from "bun:test"

import { childSpec, hostRunnerHarness } from "./rpc-host.test-support"
import type { FakeHostCommand } from "./rpc-host/__fixtures__/fake-host"
import { FAKE_HOST_CAPABILITIES } from "./rpc-host/__fixtures__/fake-host-probe"

const harness = hostRunnerHarness()
const { fakeHost, runnerOver } = harness

afterEach(harness.release)

const PROFILE_CAPABLE = [...FAKE_HOST_CAPABILITIES]
const BEFORE_PROFILE = FAKE_HOST_CAPABILITIES.filter((capability) => capability !== "retry_fallback_profile")

function openPayloads(commands: readonly FakeHostCommand[]): readonly Record<string, unknown>[] {
  return commands.filter((command) => command.type === "open_session").map((command) => command.payload)
}

describe("a daemon-hosted child's own fallback chain (#9512)", () => {
  test("#given a host that honors per-session fallback #when a child with fallback models starts #then open_session carries that child's chain keyed by its model", async () => {
    // given
    const host = await fakeHost({ capabilities: PROFILE_CAPABLE })
    const runner = runnerOver(host)

    // when
    const handle = await runner.start(childSpec({ fallbackModels: ["openai/gpt-5.6-sol:high", "zai/glm-5.3"] }))

    // then
    expect(openPayloads(host.commands)[0]?.["retryFallback"]).toEqual({
      modelFallback: true,
      fallbackChains: {
        "anthropic/claude-sonnet-4-5": ["openai/gpt-5.6-sol:high", "zai/glm-5.3"],
        "openai/gpt-5.6-sol": [],
        "zai/glm-5.3": [],
      },
    })
    await handle.terminate()
  })

  test("#given a host that honors per-session fallback #when a child designated one model starts #then open_session turns fallback off for it, so the host's settings never move it to another model (#12006)", async () => {
    // given - the host builds each session's settings from the user's settings files and senpi's shipped chains
    const host = await fakeHost({ capabilities: PROFILE_CAPABLE })
    const runner = runnerOver(host)

    // when
    const handle = await runner.start(childSpec())

    // then
    expect(openPayloads(host.commands)[0]?.["retryFallback"]).toEqual({
      modelFallback: false,
      fallbackChains: { "anthropic/claude-sonnet-4-5": [] },
    })
    await handle.terminate()
  })

  // Such a host would build the child's session from its own fallback settings (the user's chains, senpi's
  // shipped chains) and could move it to a model outside its designated chain. It is refused as a host
  // missing a required capability, before any session opens or any prompt reaches a model (#12006).
  test("#given an older host without retry_fallback_profile #when a child starts #then the host is refused as missing that capability and no session is opened or prompted", async () => {
    // given
    const host = await fakeHost({ capabilities: BEFORE_PROFILE })
    const runner = runnerOver(host)

    // when
    const started = runner.start(childSpec({ task_id: "st_31", fallbackModels: ["openai/gpt-5.6-sol"] }))

    // then
    await expect(started).rejects.toThrow("task daemon unavailable (capability): missing retry_fallback_profile")
    await expect(started).rejects.toThrow("designated models (anthropic/claude-sonnet-4-5 -> openai/gpt-5.6-sol)")
    const types = host.commands.map((command) => command.type)
    expect(types).not.toContain("open_session")
    expect(types).not.toContain("prompt")
  })

  test("#given a resumed child #when it reopens on a capable host #then the reopen carries the same chain", async () => {
    // given
    const host = await fakeHost({ capabilities: PROFILE_CAPABLE })
    const runner = runnerOver(host)
    const spec = childSpec({ fallbackModels: ["openai/gpt-5.6-sol"] })
    const first = await runner.start(spec)
    const sessionPath = host.sessions()[0]?.sessionPath ?? ""
    await first.dispose()

    // when
    const resumed = await runner.start({ ...spec, prompt: "", resumeSessionPath: sessionPath })

    // then
    const opens = openPayloads(host.commands)
    expect(opens).toHaveLength(2)
    const profile = {
      modelFallback: true,
      fallbackChains: { "anthropic/claude-sonnet-4-5": ["openai/gpt-5.6-sol"], "openai/gpt-5.6-sol": [] },
    }
    expect(opens.map((payload) => payload["retryFallback"])).toEqual([profile, profile])
    await resumed.terminate()
  })
})
