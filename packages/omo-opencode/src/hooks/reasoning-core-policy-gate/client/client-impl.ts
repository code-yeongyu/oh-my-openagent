import type { PolicyVerdict, ReasoningCoreRequest } from "../types"
import type { ReasoningCoreTransport } from "./transport-interface"
import { createTransport, type TransportMode } from "./transport-factory"
import { ReasoningCoreInfrastructureError } from "./infrastructure-error"
import { isRecord } from "./mcp-payload-extractor"
import { buildTheory } from "./theory-builder"
import { deriveVerdict } from "./verdict-deriver"
import { callTool } from "./tool-caller"
import type {
  ReasonArgueRequest,
  ReasoningCoreConstraintRequest,
  ReasoningCoreConstraintState,
  ReasoningCoreKbAddEntry,
  ReasoningCoreKbAddResult,
  ReasoningCoreKbQuery,
  ReasoningCoreKbQueryResult,
  ReasoningCoreKbRemoveEntry,
  ReasoningCoreMetacognitiveState,
  ReasoningCoreMetacognitiveStatus,
  ReasoningCoreMetacognitiveVerdict,
  ReasoningCoreSolveOutcome,
  ReasoningCoreSolveProblem,
} from "./client-types"

export interface ReasoningCoreClientConfigV2 {
  mode?: TransportMode
  httpEndpoint?: string
  binaryPath?: string
  poolSize?: number
  timeoutMs?: number
  verbose?: boolean
}

export interface ReasoningCoreClientV2 {
  argue?: (request: ReasonArgueRequest) => Promise<unknown>
  evaluate(request: ReasoningCoreRequest): Promise<PolicyVerdict>
  solve(problem: ReasoningCoreSolveProblem): Promise<ReasoningCoreSolveOutcome>
  constrain(sessionKey: string, request: ReasoningCoreConstraintRequest): Promise<ReasoningCoreConstraintState>
  kbQuery(query: ReasoningCoreKbQuery): Promise<ReasoningCoreKbQueryResult>
  kbAdd(entry: ReasoningCoreKbAddEntry): Promise<ReasoningCoreKbAddResult>
  kbRemove(entry: ReasoningCoreKbRemoveEntry): Promise<void>
  check(sessionKey: string, state: ReasoningCoreMetacognitiveState): Promise<ReasoningCoreMetacognitiveVerdict>
  status(sessionKey: string): Promise<ReasoningCoreMetacognitiveStatus>
  disposeSession(sessionKey: string): void
  disposeAll(): void
  dispose(): void
}

const DEFAULT_BINARY_PATH = "reasoning-core"
const DEFAULT_HTTP_ENDPOINT = "http://localhost:8080/mcp"
const DEFAULT_TIMEOUT_MS = 60000
const DEFAULT_POOL_SIZE = 2

export function createReasoningCoreClientV2(config?: ReasoningCoreClientConfigV2): ReasoningCoreClientV2 {
  const resolved = {
    mode: config?.mode ?? "auto",
    httpEndpoint: config?.httpEndpoint ?? DEFAULT_HTTP_ENDPOINT,
    binaryPath: config?.binaryPath ?? process.env.REASONING_CORE_BINARY_PATH ?? DEFAULT_BINARY_PATH,
    poolSize: config?.poolSize ?? DEFAULT_POOL_SIZE,
    timeoutMs: config?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  }

  let transportPromise: Promise<ReasoningCoreTransport> | undefined

  async function getTransport(): Promise<ReasoningCoreTransport> {
    if (!transportPromise) {
      transportPromise = createTransport(resolved).catch((error) => {
        transportPromise = undefined
        throw error
      })
    }
    return transportPromise
  }

  async function invoke(name: string, toolArguments: Record<string, unknown>, sessionKey?: string): Promise<unknown> {
    const transport = await getTransport()
    return callTool(transport, name, toolArguments, sessionKey)
  }

  async function evaluate(request: ReasoningCoreRequest): Promise<PolicyVerdict> {
    const theory = buildTheory(request)
    // Grounded-only by design: multi-semantics is Themis's job via
    // submit_deliberation. See docs/adr/007-reasoning-core-polish-boundaries.md.
    const payload = await invoke("reason_argue", { theory, semantics: "grounded" })
    return deriveVerdict(payload, theory)
  }

  async function argue(request: ReasonArgueRequest): Promise<unknown> {
    return await invoke("reason_argue", request as unknown as Record<string, unknown>)
  }

  async function solve(problem: ReasoningCoreSolveProblem): Promise<ReasoningCoreSolveOutcome> {
    const payload = await invoke("reason_solve", problem as unknown as Record<string, unknown>)
    if (!isRecord(payload) || !isRecord(payload.constraint_state) || typeof payload.stop_signal !== "string") {
      throw new ReasoningCoreInfrastructureError("rpc", "reasoning-core returned an invalid solve outcome")
    }
    return normalizeSolveOutcome(payload)
  }

  async function constrain(sessionKey: string, request: ReasoningCoreConstraintRequest): Promise<ReasoningCoreConstraintState> {
    const payload = await invoke("reason_constrain", request as unknown as Record<string, unknown>, sessionKey)
    if (!isRecord(payload)) {
      throw new ReasoningCoreInfrastructureError("rpc", "reasoning-core returned an invalid constraint state")
    }
    return normalizeConstraintState(payload)
  }

  async function kbQuery(query: ReasoningCoreKbQuery): Promise<ReasoningCoreKbQueryResult> {
    const payload = await invoke("reason_kb_query", query as unknown as Record<string, unknown>)
    if (!isRecord(payload)) {
      throw new ReasoningCoreInfrastructureError("rpc", "reasoning-core returned an invalid kb query result")
    }
    return {
      count: typeof payload.count === "number" ? payload.count : 0,
      entries: Array.isArray(payload.entries) ? (payload.entries as Array<Record<string, unknown>>) : [],
    }
  }

  async function kbAdd(entry: ReasoningCoreKbAddEntry): Promise<ReasoningCoreKbAddResult> {
    const payload = await invoke("reason_kb_add", entry as unknown as Record<string, unknown>)
    if (!isRecord(payload) || typeof payload.id !== "string") {
      throw new ReasoningCoreInfrastructureError("rpc", "reasoning-core returned an invalid kb add result")
    }
    return { id: payload.id }
  }

  async function kbRemove(entry: ReasoningCoreKbRemoveEntry): Promise<void> {
    await invoke("reason_kb_remove", entry as unknown as Record<string, unknown>)
  }

  async function check(sessionKey: string, state: ReasoningCoreMetacognitiveState): Promise<ReasoningCoreMetacognitiveVerdict> {
    const payload = await invoke("reason_check", state as unknown as Record<string, unknown>, sessionKey)
    if (!isRecord(payload) || typeof payload.signal !== "string" || typeof payload.iteration !== "number" || typeof payload.reason !== "string") {
      throw new ReasoningCoreInfrastructureError("rpc", "reasoning-core returned an invalid metacognitive verdict")
    }
    return { signal: payload.signal, iteration: payload.iteration, reason: payload.reason }
  }

  async function status(sessionKey: string): Promise<ReasoningCoreMetacognitiveStatus> {
    const payload = await invoke("reason_status", {}, sessionKey)
    if (!isRecord(payload)) {
      throw new ReasoningCoreInfrastructureError("rpc", "reasoning-core returned an invalid metacognitive status")
    }
    return {
      session_active: payload.session_active === true,
      domains: isRecord(payload.domains) ? (payload.domains as Record<string, number[]>) : {},
      is_solved: payload.is_solved === true,
      reasoning_history: Array.isArray(payload.reasoning_history) ? (payload.reasoning_history as Array<Record<string, unknown>>) : [],
    }
  }

  function disposeSession(sessionKey: string): void {
    if (!transportPromise) return
    transportPromise.then((transport) => {
      transport.disposeSession?.(sessionKey)
    }).catch(() => {})
  }

  function disposeAll(): void {
    if (!transportPromise) return
    const pending = transportPromise
    transportPromise = undefined
    pending.then((transport) => transport.dispose()).catch(() => {})
  }

  return {
    argue,
    evaluate,
    solve,
    constrain,
    kbQuery,
    kbAdd,
    kbRemove,
    check,
    status,
    disposeSession,
    disposeAll,
    dispose: disposeAll,
  }
}

function normalizeSolveOutcome(payload: Record<string, unknown>): ReasoningCoreSolveOutcome {
  const constraintState = payload.constraint_state as Record<string, unknown>
  return {
    stop_signal: payload.stop_signal as string,
    argumentation_result: isRecord(payload.argumentation_result)
      ? { conclusions: isRecord(payload.argumentation_result.conclusions) ? (payload.argumentation_result.conclusions as Record<string, { status?: string }>) : undefined }
      : undefined,
    constraint_state: normalizeConstraintState(constraintState),
    iterations_used: typeof payload.iterations_used === "number" ? payload.iterations_used : 0,
    reasoning_trace: Array.isArray(payload.reasoning_trace) ? (payload.reasoning_trace as Array<Record<string, unknown>>) : [],
  }
}

function normalizeConstraintState(payload: Record<string, unknown>): ReasoningCoreConstraintState {
  return {
    domains: isRecord(payload.domains) ? (payload.domains as Record<string, number[]>) : {},
    solved: payload.solved === true,
    solved_count: typeof payload.solved_count === "number" ? payload.solved_count : 0,
    total_count: typeof payload.total_count === "number" ? payload.total_count : 0,
  }
}
