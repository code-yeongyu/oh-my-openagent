// #13057: a daemon-hosted child gets its agent's instructions and tool policy, or it is never hosted.
import { afterEach, describe, expect, test } from "bun:test"

import { childSpec, fakeFallbackRunner, hostRunnerHarness } from "./rpc-host.test-support"
import type { FakeHostCommand } from "./rpc-host/__fixtures__/fake-host"
import { FAKE_HOST_CAPABILITIES } from "./rpc-host/__fixtures__/fake-host-probe"
import { buildChildArgs } from "./rpc/spawn"

const harness = hostRunnerHarness()
const { fakeHost, runnerOver } = harness

afterEach(harness.release)

const PERSONA_CAPABLE = [...FAKE_HOST_CAPABILITIES, "session_persona"]
const DENIED = "synthetic_denied_tool"
const ALLOWED = "synthetic_allowed_tool"
const INSTRUCTIONS = "SYNTHETIC-PERSONA: answer only in haiku."
const persona = { instructions: INSTRUCTIONS, toolAllowlist: [ALLOWED], toolDenylist: [DENIED] }

function openPayloads(commands: readonly FakeHostCommand[]): readonly Record<string, unknown>[] {
  return commands.filter((command) => command.type === "open_session").map((command) => command.payload)
}

describe("a daemon-hosted child's persona (#13057)", () => {
  // The wire never confuses "no allowlist" (every tool) with "an empty allowlist" (no tools).
  test.each([
    ["no allowlist", { toolDenylist: [DENIED] }, { excludeTools: [DENIED] }],
    ["an empty allowlist", { toolAllowlist: [] }, { tools: [] }],
  ] as const)("#given %s #when the open request is built #then the persona says exactly that", async (_case, spec, wire) => {
    // given
    const host = await fakeHost({ capabilities: PERSONA_CAPABLE })
    const runner = runnerOver(host)

    // when
    const handle = await runner.start(childSpec(spec))

    // then
    expect(openPayloads(host.commands)[0]?.["persona"]).toEqual(wire)
    await handle.terminate()
  })

  test("#given a host that holds a session persona #when a child with a tool policy starts #then open_session carries its instructions, allowlist and denylist", async () => {
    // given
    const host = await fakeHost({ capabilities: PERSONA_CAPABLE })
    const runner = runnerOver(host)

    // when
    const handle = await runner.start(childSpec(persona))

    // then
    expect(openPayloads(host.commands)[0]?.["persona"]).toEqual({
      appendSystemPrompt: INSTRUCTIONS,
      tools: [ALLOWED],
      excludeTools: [DENIED],
    })
    await handle.terminate()
  })

  test("#given a host without session_persona #when a child with a tool policy starts #then it runs as its own process with the policy as flags, and the host opens nothing", async () => {
    // given
    const host = await fakeHost({ capabilities: [...FAKE_HOST_CAPABILITIES] })
    const fallback = fakeFallbackRunner()
    const runner = runnerOver(host, { fallback })

    // when
    const handle = await runner.start(childSpec(persona))

    // then
    expect(handle).toBe(fallback.handle)
    expect(openPayloads(host.commands)).toHaveLength(0)
    const args = buildChildArgs(fallback.starts[0] ?? childSpec())
    expect(args).toEqual(expect.arrayContaining(["--append-system-prompt", INSTRUCTIONS, "--tools", ALLOWED]))
    expect(args.slice(args.indexOf("--exclude-tools"), args.indexOf("--exclude-tools") + 2)).toEqual([
      "--exclude-tools",
      DENIED,
    ])
  })

  test("#given a host without session_persona #when a child without a persona starts #then the host opens it as before", async () => {
    // given
    const host = await fakeHost({ capabilities: [...FAKE_HOST_CAPABILITIES] })
    const fallback = fakeFallbackRunner()
    const runner = runnerOver(host, { fallback })

    // when
    const handle = await runner.start(childSpec())

    // then
    expect(fallback.starts).toHaveLength(0)
    expect(openPayloads(host.commands)).toHaveLength(1)
    expect(openPayloads(host.commands)[0]).not.toHaveProperty("persona")
    await handle.terminate()
  })

  test("#given a resumed child #when it reopens on a capable host #then the reopen carries the same persona", async () => {
    // given
    const host = await fakeHost({ capabilities: PERSONA_CAPABLE })
    const runner = runnerOver(host)
    const spec = childSpec(persona)
    const first = await runner.start(spec)
    const sessionPath = host.sessions()[0]?.sessionPath ?? ""
    await first.dispose()

    // when
    const resumed = await runner.start({ ...spec, prompt: "", resumeSessionPath: sessionPath })

    // then
    const opens = openPayloads(host.commands).map((payload) => payload["persona"])
    expect(opens).toHaveLength(2)
    expect(opens[1]).toEqual(opens[0])
    expect(opens[1]).toMatchObject({ excludeTools: [DENIED] })
    await resumed.terminate()
  })

  test("#given a child recorded on a host without session_persona #when it is revived #then it is refused typed and never reopened in its own process", async () => {
    // given
    const host = await fakeHost({ capabilities: [...FAKE_HOST_CAPABILITIES] })
    const fallback = fakeFallbackRunner()
    const runner = runnerOver(host, { fallback })

    // when
    const revived = runner.start(
      childSpec({ ...persona, prompt: "", hostSocket: host.socketPath, resumeSessionPath: "/tmp/dh-30-state/s.jsonl" }),
    )

    // then
    await expect(revived).rejects.toMatchObject({
      failure: { kind: "host_unavailable", reason: "host_persona_unsupported" },
    })
    expect(fallback.starts).toHaveLength(0)
    expect(openPayloads(host.commands)).toHaveLength(0)
  })
})
