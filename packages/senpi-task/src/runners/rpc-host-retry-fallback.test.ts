import { afterEach, describe, expect, test } from "bun:test"

import { childSpec, hostRunnerHarness } from "./rpc-host.test-support"
import type { FakeHostCommand } from "./rpc-host/__fixtures__/fake-host"
import { FAKE_HOST_CAPABILITIES } from "./rpc-host/__fixtures__/fake-host-probe"

const harness = hostRunnerHarness()
const { fakeHost, runnerOver } = harness

afterEach(harness.release)

const PROFILE_CAPABLE = [...FAKE_HOST_CAPABILITIES, "retry_fallback_profile"]

function openPayloads(commands: readonly FakeHostCommand[]): readonly Record<string, unknown>[] {
  return commands.filter((command) => command.type === "open_session").map((command) => command.payload)
}

describe("a daemon-hosted child's own fallback chain (#9512)", () => {
  test("#given a host that honors per-session fallback #when a child with fallback models starts #then open_session carries that child's chain keyed by its model", async () => {
    // given
    const host = await fakeHost({ capabilities: PROFILE_CAPABLE })
    const runner = runnerOver(host)

    // when
    const handle = await runner.start(
      childSpec({ fallbackModels: ["openai/gpt-5.6-sol:high", "zai/glm-5.3"] }),
    )

    // then
    expect(openPayloads(host.commands)[0]?.["retryFallback"]).toEqual({
      modelFallback: true,
      fallbackChains: { "anthropic/claude-sonnet-4-5": ["openai/gpt-5.6-sol:high", "zai/glm-5.3"] },
    })
    await handle.terminate()
  })

  test("#given a host that honors per-session fallback #when a child without fallback models starts #then open_session carries no profile, so the child keeps the fallback chain the user's settings give it", async () => {
    // given - the host builds each session's settings from the user's settings files; a child with no
    // chain of its own must keep falling back through them exactly as it did before #9512
    const host = await fakeHost({ capabilities: PROFILE_CAPABLE })
    const runner = runnerOver(host)

    // when
    const handle = await runner.start(childSpec())

    // then
    expect(openPayloads(host.commands)[0]).not.toHaveProperty("retryFallback")
    await handle.terminate()
  })

  test("#given an older host without retry_fallback_profile #when two children with fallback models start #then both still open without the field and the user is told once", async () => {
    // given
    const host = await fakeHost()
    const warnings: string[] = []
    const runner = runnerOver(host, { onWarning: (message) => void warnings.push(message) })

    // when
    const first = await runner.start(childSpec({ task_id: "st_31", fallbackModels: ["openai/gpt-5.6-sol"] }))
    const second = await runner.start(childSpec({ task_id: "st_32", fallbackModels: ["openai/gpt-5.6-sol"] }))

    // then
    const opens = openPayloads(host.commands)
    expect(opens).toHaveLength(2)
    expect(opens.map((payload) => "retryFallback" in payload)).toEqual([false, false])
    const notices = warnings.filter((message) => message.includes("retry_fallback_profile"))
    expect(notices).toHaveLength(1)
    await first.terminate()
    await second.terminate()
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
    expect(opens.map((payload) => payload["retryFallback"])).toEqual([
      { modelFallback: true, fallbackChains: { "anthropic/claude-sonnet-4-5": ["openai/gpt-5.6-sol"] } },
      { modelFallback: true, fallbackChains: { "anthropic/claude-sonnet-4-5": ["openai/gpt-5.6-sol"] } },
    ])
    await resumed.terminate()
  })
})
