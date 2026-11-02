import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import type { ChildModelRegistry, ChildSpec, CreateChildSession, InProcessRunnerLike } from "@oh-my-opencode/senpi-task"

import { childModelChainSpec, type ChildModelChainSpec } from "../memory/memory-child-model-chain"
import { resolveKibitzerSidecarModel } from "../memory/kibitzer/sidecar-model"
import { loadKibitzerTaskRuntime, type KibitzerTaskRuntime } from "../memory/kibitzer/task-runtime"
import { runBoundedChild, type BoundedChildOutcome } from "./bounded-child"
import { ADVISOR_SYSTEM_PROMPT } from "./prompt"

type AdvisorTaskRuntime = Pick<KibitzerTaskRuntime, "createInProcessJudgeRunner" | "findModelReference">
type ThinkingLevel = NonNullable<ChildSpec["thinkingLevel"]>

export type AdvisorChildOutcome =
  | { readonly kind: "advice"; readonly text: string; readonly model: string; readonly ms: number }
  | { readonly kind: "unavailable"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string; readonly model?: string }

export interface AdvisorChildRequest {
  readonly sessionId: string
  readonly sequence: number
  readonly cwd: string
  readonly sessionDir: string
  readonly agentDir: string
  readonly model: string
  readonly thinking: ThinkingLevel
  readonly category: string
  readonly config: OmoConfig
  readonly registry: ChildModelRegistry | undefined
  readonly prompt: string
  readonly timeoutMs: number
  readonly signal?: AbortSignal
}

export interface AdvisorChildSeams {
  readonly loadTaskRuntime?: () => Promise<AdvisorTaskRuntime>
  readonly createRunner?: (options: { readonly createSession?: CreateChildSession }) => InProcessRunnerLike
}

interface AdvisorCandidate {
  readonly model: string
  readonly thinking?: ThinkingLevel
  readonly chain: ChildModelChainSpec
}

/** Starts ONE tool-less child on the advisor model, waits for its single turn, and returns its text. */
export async function runAdvisorChild(request: AdvisorChildRequest, seams: AdvisorChildSeams = {}): Promise<AdvisorChildOutcome> {
  let runtime: AdvisorTaskRuntime | undefined
  if (seams.createRunner === undefined) {
    try {
      runtime = await (seams.loadTaskRuntime ?? loadKibitzerTaskRuntime)()
    } catch (error) {
      return { kind: "unavailable", reason: `runtime_unavailable: ${describe(error)}` }
    }
  }
  const runner = seams.createRunner?.({}) ?? runtime?.createInProcessJudgeRunner({})
  if (runner === undefined) return { kind: "unavailable", reason: "runtime_unavailable" }
  const failures: string[] = []
  for (const candidate of advisorCandidates(request)) {
    const outcome = await runBoundedChild(runner, buildSpec(request, candidate, runtime), candidate.model, request.timeoutMs, request.signal)
    if (outcome.kind === "start_failed") {
      failures.push(`${candidate.model}: ${outcome.reason}`)
      continue
    }
    if (!isEmptyReply(outcome) || !canRetryLower(candidate.thinking)) return outcome
    return retryAtLowerThinking(runner, request, candidate, runtime)
  }
  return { kind: "failed", reason: `start_failed: ${failures.join("; ") || "no candidate"}` }
}

const RETRY_THINKING: ThinkingLevel = "off"

function isEmptyReply(outcome: BoundedChildOutcome): outcome is { readonly kind: "failed"; readonly reason: string; readonly model?: string } {
  return outcome.kind === "failed" && outcome.reason === "empty"
}

function canRetryLower(thinking: ThinkingLevel | undefined): boolean {
  return thinking !== undefined && thinking !== RETRY_THINKING
}

// A thinking level can spend the whole output budget on reasoning and end the turn with no text
// (measured on DeepSeek V4.1 Flash: `max` and `low` both stop at `length` after 16,384 reasoning
// tokens; `off` still reasons but finishes the plan). One retry at `off` leaves the most room; a
// second empty reply is reported as it is.
async function retryAtLowerThinking(
  runner: InProcessRunnerLike,
  request: AdvisorChildRequest,
  candidate: AdvisorCandidate,
  runtime: AdvisorTaskRuntime | undefined,
): Promise<AdvisorChildOutcome> {
  const lowered: AdvisorCandidate = { ...candidate, thinking: RETRY_THINKING }
  const spec = { ...buildSpec(request, lowered, runtime), taskId: `advisor-${request.sessionId}-${request.sequence}-retry` }
  const outcome = await runBoundedChild(runner, spec, candidate.model, request.timeoutMs, request.signal)
  if (outcome.kind === "advice") return outcome
  return { kind: "failed", reason: `empty at ${candidate.thinking}, then ${outcome.reason} at ${RETRY_THINKING}`, model: candidate.model }
}

function advisorCandidates(request: AdvisorChildRequest): readonly AdvisorCandidate[] {
  const pinned: AdvisorCandidate = { model: request.model, thinking: request.thinking, chain: childModelChainSpec({ model: request.model, fallbacks: [] }) }
  const resolution = resolveKibitzerSidecarModel({ category: request.category, config: request.config, registry: request.registry })
  if (resolution.kind === "unavailable" || resolution.model === request.model) return [pinned]
  return [pinned, { model: resolution.model, ...(resolution.thinking === undefined ? {} : { thinking: resolution.thinking }), chain: resolution.chain }]
}

function buildSpec(request: AdvisorChildRequest, candidate: AdvisorCandidate, runtime: AdvisorTaskRuntime | undefined): ChildSpec {
  const registry = request.registry
  const model = registry === undefined || runtime === undefined ? undefined : runtime.findModelReference(registry, candidate.model)
  return {
    taskId: `advisor-${request.sessionId}-${request.sequence}`,
    cwd: request.cwd,
    sessionDir: request.sessionDir,
    agentDir: request.agentDir,
    ...(registry === undefined ? {} : { modelRegistry: registry }),
    ...(model === undefined ? {} : { model }),
    ...candidate.chain,
    ...(candidate.thinking === undefined ? {} : { thinkingLevel: candidate.thinking }),
    toolAllowlist: [],
    depth: 1,
    parentSessionId: request.sessionId,
    rootSessionId: request.sessionId,
    systemPrompt: ADVISOR_SYSTEM_PROMPT,
    promptEnvelope: "bare",
    completion: "turn",
    prompt: request.prompt,
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
