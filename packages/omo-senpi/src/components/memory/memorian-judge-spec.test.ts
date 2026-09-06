import { describe, expect, test } from "bun:test"
import type { RecallNudge } from "@oh-my-opencode/memory-core"
import { MEMORIAN_NUDGE_TOOL_NAME, type MemorianNudgeTool } from "./memorian-nudge-tool"
import { buildMemorianJudgeSpec } from "./memorian-judge-spec"
import { CANDIDATE_PATH, launchInput } from "./memorian-runner.test-support"

const HINT = "Drain nodes before a rollout."

describe("buildMemorianJudgeSpec", () => {
  test("#given a launch input #when the spec is built #then the nudge closure writes accepted output and the child surface stays restricted", async () => {
    // given
    const accepted: RecallNudge[] = []
    const launch = launchInput()

    // when
    const spec = buildMemorianJudgeSpec({
      launch,
      runId: "run-spec-1",
      runDir: "/tmp/memorian-spec-run",
      agentDir: "/tmp/memorian-spec-agent",
      model: undefined,
      accepted,
    })
    const nudge = spec.memberScopedTools?.find((tool): tool is MemorianNudgeTool => tool.name === MEMORIAN_NUDGE_TOOL_NAME)
    if (nudge === undefined) throw new Error("nudge tool missing from the judge spec")
    const recorded = await nudge.execute("call-1", { path: CANDIDATE_PATH, hint: HINT })
    const rejected = await nudge.execute("call-2", { path: "notes/never-offered.md", hint: HINT })

    // then
    expect(spec.completion).toBe("turn")
    expect(spec.promptEnvelope).toBe("bare")
    expect(spec.toolAllowlist).toEqual([MEMORIAN_NUDGE_TOOL_NAME])
    expect(spec.memberScopedTools?.map((tool) => tool.name)).toEqual([MEMORIAN_NUDGE_TOOL_NAME])
    expect(recorded.isError).toBeUndefined()
    expect(rejected.isError).toBe(true)
    expect(accepted).toEqual([{ path: CANDIDATE_PATH, hint: HINT }])
  })
})
