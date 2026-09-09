import { loadKibitzerPersona } from "@oh-my-opencode/memory-core"
import type { RecallNudge } from "@oh-my-opencode/memory-core"
import type { ChildSpec } from "@oh-my-opencode/senpi-task"
import type { ChildModelChainSpec } from "./memory-child-model-chain"
import type { KibitzerGateLaunchInput } from "./kibitzer-runner"
import { createKibitzerNudgeTool, KIBITZER_NUDGE_TOOL_NAME } from "./kibitzer-nudge-tool"
import { buildKibitzerPrompt } from "./kibitzer-prompt"

type JudgeSpecInput = {
  readonly launch: KibitzerGateLaunchInput
  readonly runId: string
  readonly runDir: string
  readonly agentDir: string
  readonly model: ChildSpec["model"]
  readonly chain: ChildModelChainSpec
  readonly thinkingLevel?: ChildSpec["thinkingLevel"]
  readonly accepted: RecallNudge[]
}

export function buildKibitzerJudgeSpec(input: JudgeSpecInput): ChildSpec {
  const { launch, chain } = input
  return {
    taskId: `kibitzer-${input.runId}`,
    cwd: input.runDir,
    sessionDir: input.runDir,
    agentDir: input.agentDir,
    modelRegistry: launch.modelRegistry,
    model: input.model,
    ...chain,
    ...(input.thinkingLevel === undefined ? {} : { thinkingLevel: input.thinkingLevel }),
    toolAllowlist: [KIBITZER_NUDGE_TOOL_NAME],
    memberScopedTools: [createKibitzerNudgeTool({
      candidates: new Set(launch.candidates.map((candidate) => candidate.path)),
      surfaced: launch.surfaced,
      maxItems: launch.maxItems,
      accepted: input.accepted,
    })],
    depth: 1,
    parentSessionId: launch.sessionId,
    rootSessionId: launch.sessionId,
    systemPrompt: loadKibitzerPersona(),
    promptEnvelope: "bare",
    completion: "turn",
    prompt: buildKibitzerPrompt(launch),
  }
}
