import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import type { ChildModelRegistry, ChildSpec, CreateChildSession, InProcessRunnerLike } from "@oh-my-opencode/senpi-task"

import { childModelChainSpec } from "../memory/memory-child-model-chain"
import { resolveKibitzerSidecarModel } from "../memory/kibitzer/sidecar-model"
import { loadKibitzerTaskRuntime, type KibitzerTaskRuntime } from "../memory/kibitzer/task-runtime"
import { ADVISOR_SYSTEM_PROMPT, renderAdvisorPrompt } from "./prompt"

type AdvisorTaskRuntime = Pick<KibitzerTaskRuntime, "createInProcessJudgeRunner" | "findModelReference">

export type AdvisorChildOutcome =
  | { readonly kind: "advice"; readonly text: string; readonly model: string }
  | { readonly kind: "unavailable"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string; readonly model?: string }

export interface AdvisorChildRequest {
  readonly sessionId: string
  readonly sequence: number
  readonly cwd: string
  readonly sessionDir: string
  readonly agentDir: string
  readonly model: string | undefined
  readonly category: string
  readonly config: OmoConfig
  readonly registry: ChildModelRegistry | undefined
  readonly state: string
  readonly timeoutMs: number
}

export interface AdvisorChildSeams {
  readonly loadTaskRuntime?: () => Promise<AdvisorTaskRuntime>
  readonly createRunner?: (options: { readonly createSession?: CreateChildSession }) => InProcessRunnerLike
}

/** Starts ONE tool-less child on the advisor model, waits for its single turn, and returns its text. */
export async function runAdvisorChild(request: AdvisorChildRequest, seams: AdvisorChildSeams = {}): Promise<AdvisorChildOutcome> {
  const selection = selectAdvisorModel(request)
  if (selection.kind === "unavailable") return selection
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
  const registry = request.registry
  const spec: ChildSpec = {
    taskId: `advisor-${request.sessionId}-${request.sequence}`,
    cwd: request.cwd,
    sessionDir: request.sessionDir,
    agentDir: request.agentDir,
    ...(registry === undefined ? {} : { modelRegistry: registry }),
    ...(registry === undefined || runtime === undefined ? {} : { model: runtime.findModelReference(registry, selection.model) }),
    ...selection.chain,
    toolAllowlist: [],
    depth: 1,
    parentSessionId: request.sessionId,
    rootSessionId: request.sessionId,
    systemPrompt: ADVISOR_SYSTEM_PROMPT,
    promptEnvelope: "bare",
    completion: "turn",
    prompt: renderAdvisorPrompt(request.state),
  }
  let handle: Awaited<ReturnType<InProcessRunnerLike["start"]>>
  try {
    handle = await runner.start(spec)
  } catch (error) {
    return { kind: "failed", reason: `start_failed: ${describe(error)}`, model: selection.model }
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timedOut = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), request.timeoutMs)
      timer.unref?.()
    })
    const finished = await Promise.race([handle.waitForIdle().then(() => "idle" as const), timedOut])
    if (finished === "timeout") {
      await handle.abort().catch(() => undefined)
      return { kind: "failed", reason: "timeout", model: selection.model }
    }
    const text = handle.lastAssistantText()?.trim()
    if (text === undefined || text.length === 0) return { kind: "failed", reason: "empty", model: selection.model }
    return { kind: "advice", text, model: selection.model }
  } catch (error) {
    return { kind: "failed", reason: describe(error), model: selection.model }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    await Promise.resolve(handle.dispose()).catch(() => undefined)
  }
}

type AdvisorModelSelection =
  | { readonly kind: "selected"; readonly model: string; readonly chain: ReturnType<typeof childModelChainSpec> }
  | { readonly kind: "unavailable"; readonly reason: string }

function selectAdvisorModel(request: AdvisorChildRequest): AdvisorModelSelection {
  if (request.model !== undefined) {
    return { kind: "selected", model: request.model, chain: childModelChainSpec({ model: request.model, fallbacks: [] }) }
  }
  const resolution = resolveKibitzerSidecarModel({ category: request.category, config: request.config, registry: request.registry })
  if (resolution.kind === "unavailable") return { kind: "unavailable", reason: `category_${resolution.cause}: ${resolution.category}` }
  return { kind: "selected", model: resolution.model, chain: resolution.chain }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
