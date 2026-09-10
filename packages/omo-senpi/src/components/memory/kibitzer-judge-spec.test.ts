import { describe, expect, test } from "bun:test"
import type { RecallNudge } from "@oh-my-opencode/memory-core"
import type { ResolvedModelRecord } from "@oh-my-opencode/senpi-task"
import { KIBITZER_NUDGE_TOOL_NAME, type KibitzerNudgeTool } from "./kibitzer-nudge-tool"
import { buildKibitzerJudgeSpec } from "./kibitzer-judge-spec"
import type { ChildModelChainSpec } from "./memory-child-model-chain"
import { CANDIDATE_PATH, launchInput } from "./kibitzer-runner.test-support"

const HINT = "Drain nodes before a rollout."
const PRIMARY = "omo-mock/mock-1"
const FALLBACK: ResolvedModelRecord = { provider: "omo-mock", model_id: "mock-2", display: "omo-mock/mock-2", source: "category" }

function specInput(chain: ChildModelChainSpec) {
  return {
    launch: launchInput(),
    runId: "run-spec-chain",
    runDir: "/tmp/kibitzer-spec-run",
    agentDir: "/tmp/kibitzer-spec-agent",
    model: undefined,
    chain,
    accepted: [],
  }
}

describe("buildKibitzerJudgeSpec", () => {
  test("#given a launch input #when the spec is built #then the nudge closure writes accepted output and the child surface stays restricted", async () => {
    // given
    const accepted: RecallNudge[] = []
    const launch = launchInput()

    // when
    const spec = buildKibitzerJudgeSpec({
      launch,
      runId: "run-spec-1",
      runDir: "/tmp/kibitzer-spec-run",
      agentDir: "/tmp/kibitzer-spec-agent",
      model: undefined,
      chain: { selectedModel: PRIMARY },
      accepted,
    })
    const nudge = spec.memberScopedTools?.find((tool): tool is KibitzerNudgeTool => tool.name === KIBITZER_NUDGE_TOOL_NAME)
    if (nudge === undefined) throw new Error("nudge tool missing from the judge spec")
    const recorded = await nudge.execute("call-1", { path: CANDIDATE_PATH, hint: HINT })
    const rejected = await nudge.execute("call-2", { path: "notes/never-offered.md", hint: HINT })

    // then
    expect(spec.completion).toBe("turn")
    expect(spec.promptEnvelope).toBe("bare")
    expect(spec.toolAllowlist).toEqual([KIBITZER_NUDGE_TOOL_NAME])
    expect(spec.memberScopedTools?.map((tool) => tool.name)).toEqual([KIBITZER_NUDGE_TOOL_NAME])
    expect(recorded.isError).toBeUndefined()
    expect(rejected.isError).toBe(true)
    expect(accepted).toEqual([{ path: CANDIDATE_PATH, hint: HINT }])
  })

  test("#given a resolved quick chain #when the spec is built #then the child carries the selected model, its in-category fallbacks and a one-retry same-model budget", () => {
    // given / when
    const spec = buildKibitzerJudgeSpec(specInput({ selectedModel: PRIMARY, fallbackModels: [FALLBACK], retry: { maxRetries: 1 } }))

    // then: the runtime fallback settings of the child are keyed by the primary selector, and the
    // same-model budget is cut to one retry so a rung costs seconds, not the default ~62s backoff.
    expect(spec.selectedModel).toBe(PRIMARY)
    expect(spec.fallbackModels).toEqual([FALLBACK])
    expect(spec.retry).toEqual({ maxRetries: 1 })
  })

  test("#given a single-model quick category #when the spec is built #then no fallback list is attached and the engine's default same-model budget is kept", () => {
    // given / when
    const spec = buildKibitzerJudgeSpec(specInput({ selectedModel: PRIMARY }))

    // then
    expect(spec.selectedModel).toBe(PRIMARY)
    expect(spec.fallbackModels).toBeUndefined()
    expect(spec.retry).toBeUndefined()
  })
})
