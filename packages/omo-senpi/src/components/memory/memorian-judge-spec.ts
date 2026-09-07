import { loadMemorianPersona } from "@oh-my-opencode/memory-core"
import type { RecallNudge } from "@oh-my-opencode/memory-core"
import type { ChildSpec } from "@oh-my-opencode/senpi-task"
import type { ChildModelChainSpec } from "./memory-child-model-chain"
import type { MemorianGateLaunchInput } from "./memorian-runner"
import { createMemorianNudgeTool, MEMORIAN_NUDGE_TOOL_NAME } from "./memorian-nudge-tool"
import { buildMemorianPrompt } from "./memorian-prompt"

type JudgeSpecInput = {
  readonly launch: MemorianGateLaunchInput
  readonly runId: string
  readonly runDir: string
  readonly agentDir: string
  readonly model: ChildSpec["model"]
  readonly chain: ChildModelChainSpec
  readonly thinkingLevel?: ChildSpec["thinkingLevel"]
  readonly accepted: RecallNudge[]
}

export function buildMemorianJudgeSpec(input: JudgeSpecInput): ChildSpec {
  const { launch, chain } = input
  return {
    taskId: `memorian-${input.runId}`,
    cwd: input.runDir,
    sessionDir: input.runDir,
    agentDir: input.agentDir,
    modelRegistry: launch.modelRegistry,
    model: input.model,
    ...chain,
    ...(input.thinkingLevel === undefined ? {} : { thinkingLevel: input.thinkingLevel }),
    toolAllowlist: [MEMORIAN_NUDGE_TOOL_NAME],
    memberScopedTools: [createMemorianNudgeTool({
      candidates: new Set(launch.candidates.map((candidate) => candidate.path)),
      surfaced: launch.surfaced,
      maxItems: launch.maxItems,
      accepted: input.accepted,
    })],
    depth: 1,
    parentSessionId: launch.sessionId,
    rootSessionId: launch.sessionId,
    systemPrompt: loadMemorianPersona(),
    promptEnvelope: "bare",
    completion: "turn",
    prompt: buildMemorianPrompt(launch),
  }
}
