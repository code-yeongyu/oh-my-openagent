import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createUlwLoopComponent } from "./index"
import { normalizeUlwLoopSessionId, ulwLoopStatusArgs } from "./session-scope"
import { activeStatus, createLogger, type RecordedLog } from "./ulw-loop.test-support"
import type { ComponentLogger } from "../../extension/types"

interface RunnerCall {
  bin: string
  args: readonly string[]
  cwd: string
}

async function registerScoped(
  options: { planDirExists?: (cwd: string) => boolean; stdout?: string } = {},
): Promise<{
  pi: FakeExtensionAPI
  calls: RunnerCall[]
  logger: ComponentLogger & { entries: RecordedLog[] }
}> {
  const pi = new FakeExtensionAPI()
  const calls: RunnerCall[] = []
  const logger = createLogger()
  await createUlwLoopComponent({
    resolveOmoBin: () => "/tmp/omo",
    planDirExists: options.planDirExists ?? (() => true),
    runCommand: async (bin, args, runOptions) => {
      calls.push({ bin, args, cwd: runOptions.cwd })
      return { code: 0, stdout: options.stdout ?? activeStatus() }
    },
  }).register(pi, { logger, config: { getFlag: () => false } })
  return { pi, calls, logger }
}

function sessionCtx(cwd: string, sessionId: string): Record<string, unknown> {
  return { cwd, sessionManager: { getSessionId: () => sessionId } }
}

describe("omo-senpi ulw-loop status probe session scope", () => {
  it("#given a session id on the host #when the status probe runs #then every invocation carries --session-id", async () => {
    const { pi, calls } = await registerScoped()
    const ctx = sessionCtx("/repo", "sess A/../weird")
    const expected = ["ulw-loop", "status", "--json", "--session-id", "sess-A-weird"]

    await pi.dispatch("session_start", { type: "session_start" }, ctx)
    await pi.dispatch(
      "input",
      { type: "input", text: "continue", source: "interactive", streamingBehavior: "steer" },
      ctx,
    )
    await pi.dispatch("agent_end", { type: "agent_end" }, ctx)
    await pi.dispatch("tool_result", { toolName: "bash" }, ctx)

    expect(calls).toHaveLength(4)
    for (const call of calls) expect(call.args).toEqual(expected)
  })

  it("#given NO session id available #when agent_end fires on an active unscoped run #then no continuation is delivered", async () => {
    const { pi, calls, logger } = await registerScoped()

    await pi.dispatch("agent_end", { type: "agent_end" }, { cwd: "/repo" })

    expect(pi.messages).toEqual([])
    expect(pi.userMessages).toEqual([])
    expect(calls).toEqual([])
    expect(logger.entries).toContainEqual({
      level: "info",
      message: "omo-senpi ulw-loop continuation skipped",
      details: { reason: "session-id-unavailable" },
    })
  })

  it("#given NO session id available #when queued user input arrives #then no steering reminder is injected", async () => {
    const { pi, calls } = await registerScoped()

    const results = await pi.dispatch(
      "input",
      { type: "input", text: "continue", source: "interactive", streamingBehavior: "steer" },
      { cwd: "/repo" },
    )

    expect(results).toEqual([{ action: "continue" }])
    expect(calls).toEqual([])
  })

  it("#given a session id but no .omo/ulw-loop directory #when agent_end fires #then the perf guard short-circuits with no spawn", async () => {
    const { pi, calls } = await registerScoped({ planDirExists: () => false })

    await pi.dispatch("agent_end", { type: "agent_end" }, sessionCtx("/repo", "sess-guard"))

    expect(calls).toEqual([])
    expect(pi.messages).toEqual([])
  })
})

// Reference implementation copied verbatim from the toolkit normalizer this component must agree with:
// packages/omo-codex/plugin/components/ulw-loop/src/paths.ts `normalizeUlwLoopSessionId`. The adapter
// boundary forbids importing omo-codex from here, so parity is pinned by re-running the same rules and
// by the literal expectations below.
function toolkitNormalize(sessionId: string | null | undefined): string | null {
  const trimmed = sessionId?.trim()
  if (!trimmed) return null
  const pathSegments = trimmed
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..")
  const candidate = (pathSegments.length > 0 ? pathSegments.join("-") : trimmed)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+/, "")
    .replace(/^[.-]+|[.-]+$/g, "")
  return candidate.length > 0 ? candidate : null
}

describe("omo-senpi ulw-loop session id normalization parity", () => {
  const cases: Array<[string | null | undefined, string | null]> = [
    ["plain-session", "plain-session"],
    ["sess/with/slashes", "sess-with-slashes"],
    ["sess\\with\\backslashes", "sess-with-backslashes"],
    ["../../escape", "escape"],
    ["..", null],
    [".", null],
    [".hidden-session", "hidden-session"],
    ["  padded  ", "padded"],
    ["session with spaces", "session-with-spaces"],
    ["세션-유니코드", null],
    ["session::id!!", "session-id"],
    ["---leading-and-trailing---", "leading-and-trailing"],
    ["a/b/../c", "a-b-c"],
    ["", null],
    ["   ", null],
    ["///", null],
    ["!!!", null],
    ["senpi:2026-08-21T00:00:00.000Z", "senpi-2026-08-21T00-00-00.000Z"],
    [undefined, null],
    [null, null],
  ]

  it("#given ids the toolkit also normalizes #when the senpi normalizer runs #then both agree exactly", () => {
    for (const [input, expected] of cases) {
      expect([input, normalizeUlwLoopSessionId(input)]).toEqual([input, expected])
      expect([input, toolkitNormalize(input)]).toEqual([input, expected])
    }
  })

  it("#given a normalized session id #when building status args #then the toolkit flag order is stable", () => {
    expect(ulwLoopStatusArgs("sess-A")).toEqual(["ulw-loop", "status", "--json", "--session-id", "sess-A"])
  })
})
