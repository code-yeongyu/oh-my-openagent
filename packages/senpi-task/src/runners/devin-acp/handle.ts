import type { ManagedChildEvent, ManagedChildHandle, ManagedChildListener } from "../../manager/child-handle"
import type { InputIdentity } from "../types"
import type { EffectiveModel } from "../pinned-model-equivalence"
import type { RunnerOutcome } from "../in-process/child-handle"
import { AcpClient } from "./client"
import type { AcpPromptResult, AcpSessionUpdate, AcpSessionUpdateParams } from "./protocol"

// Devin's cognition.ai/subagent_context routes updates emitted inside a Devin subagent; "root" (and
// an absent context) is the session's own agent. Subagent chunks never pollute the child's answer.
const SUBAGENT_CONTEXT_META = "cognition.ai/subagent_context"
const INFERENCE_TOOL_NAME_META = "cognition.ai/inferenceToolName"
const SUBAGENT_STARTED_META = "cognition.ai/subagent_started"
const SUBAGENT_COMPLETED_META = "cognition.ai/subagent_completed"

type TurnObservation = {
  text: string
  stopReason: string | undefined
  error: string | undefined
  usage: { input?: number; output?: number; total?: number } | undefined
}

type ToolCallState = {
  name: string
  started: boolean
  ended: boolean
}

type Deferred = {
  promise: Promise<RunnerOutcome>
  resolve: (outcome: RunnerOutcome) => void
}

function deferred(): Deferred {
  let resolve!: (outcome: RunnerOutcome) => void
  const promise = new Promise<RunnerOutcome>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

export type DevinAcpChildHandleInput = {
  readonly taskId: string
  readonly client: AcpClient
  readonly sessionId: string
  readonly modelId: string
}

/**
 * A Devin `acp` session behind the ManagedChildHandle seam. ACP has no steer/queue primitive, so
 * inputs run through a client-side pump: `steer` jumps the queue and cancels the in-flight prompt
 * (the cancelled turn is swallowed and the pump continues with the steering text); `followUp`
 * appends. `waitForOutcome` resolves when the queue drains on a settled turn, is cancelled by
 * `abort`, or reports the last settled outcome while idle - the same contract the in-process
 * tracked handle gives the manager.
 */
export class DevinAcpChildHandle implements ManagedChildHandle {
  readonly task_id: string
  readonly kind = "rpc" as const
  readonly sessionId: string
  readonly pid: number | undefined
  readonly #client: AcpClient
  readonly #listeners = new Set<ManagedChildListener>()
  readonly #tools = new Map<string, ToolCallState>()

  #modelId: string
  #queue: string[] = []
  #pumping = false
  #promptActive = false
  #abortRequested = false
  #observation: TurnObservation | undefined
  #lastText: string | undefined
  #lastSeenValue: number | undefined
  #exited = false
  #outcome = deferred()
  #lastOutcome: RunnerOutcome | undefined

  constructor(input: DevinAcpChildHandleInput) {
    this.task_id = input.taskId
    this.sessionId = input.sessionId
    this.pid = input.client.pid
    this.#client = input.client
    this.#modelId = input.modelId
  }

  onSessionUpdate(params: AcpSessionUpdateParams): void {
    // ACP notifications may omit params entirely or carry a non-object update; both are ignored
    // rather than throwing inside the client's stdout dispatch.
    if (typeof params !== "object" || params === null) return
    const update = params.update
    if (typeof update !== "object" || update === null) return
    this.#lastSeenValue = Date.now()
    if (this.#isSubagentUpdate(update)) return
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
        this.#onMessageChunk(update)
        return
      case "agent_thought_chunk":
      case "user_message_chunk":
        return
      case "tool_call":
        this.#onToolCall(update)
        return
      case "tool_call_update":
        this.#onToolCallUpdate(update)
        return
      case "usage_update":
        this.#onUsageUpdate(update)
        return
      case "config_option_update":
        this.#onConfigOptionUpdate(update)
        return
      default:
        return
    }
  }

  onProcessExit(): void {
    this.#exited = true
    if (this.#pumping) {
      // The pending session/prompt rejects via the client's exit path; the pump settles the turn
      // as an error outcome on its own.
      return
    }
    if (this.#lastOutcome === undefined) {
      this.#settle({
        status: "error",
        failure: { kind: "child-unresponsive", message: "devin acp process exited" },
      })
    }
  }

  steer(text: string, _identity?: InputIdentity): Promise<void> {
    this.#queue.unshift(text)
    if (this.#promptActive) this.#client.sessionCancel(this.sessionId)
    void this.#pump()
    return Promise.resolve()
  }

  followUp(text: string, _identity?: InputIdentity): Promise<void> {
    this.#queue.push(text)
    void this.#pump()
    return Promise.resolve()
  }

  abort(): Promise<void> {
    this.#abortRequested = true
    this.#queue = []
    if (this.#promptActive) this.#client.sessionCancel(this.sessionId)
    if (!this.#pumping) this.#settle({ status: "cancelled" })
    return Promise.resolve()
  }

  subscribe(listener: ManagedChildListener): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  waitForOutcome(): Promise<RunnerOutcome> {
    if (this.#pumping) return this.#outcome.promise
    if (this.#lastOutcome !== undefined) return Promise.resolve(this.#lastOutcome)
    return this.#outcome.promise
  }

  lastAssistantText(): string | undefined {
    return this.#observation?.text ?? this.#lastText
  }

  hasExited(): boolean {
    return this.#exited || this.#client.closed
  }

  lastSeen(): number | undefined {
    return this.#lastSeenValue
  }

  effectiveModel(): EffectiveModel | undefined {
    return { provider: "devin", id: this.#modelId }
  }

  async terminate(): Promise<void> {
    await this.#client.dispose()
    this.#exited = true
  }

  async dispose(): Promise<void> {
    this.#queue = []
    try {
      await this.#client.sessionClose(this.sessionId)
    } catch {
      // session/close is best-effort; the process is going away either way
    }
    await this.#client.dispose()
    this.#listeners.clear()
  }

  // ---- input pump ----

  async #pump(): Promise<void> {
    if (this.#pumping) return
    this.#pumping = true
    this.#lastOutcome = undefined
    try {
      while (this.#queue.length > 0) {
        if (this.#abortRequested) break
        const text = this.#queue.shift()
        if (text === undefined) break
        const turn = await this.#runPrompt(text)
        if (this.#abortRequested) break
        if (turn.stopReason === "cancelled") {
          // A steer cancelled this turn on purpose: swallow it and let the queued steering text
          // (already at the front) drive the next prompt. A bare cancel with nothing queued is an
          // interruption the parent did not ask for.
          if (this.#queue.length === 0) {
            this.#settle({ status: "interrupted", message: "devin acp turn was cancelled" })
            return
          }
          continue
        }
        if (this.#queue.length === 0) {
          this.#settle(outcomeForTurn(turn, this.#modelId))
          return
        }
      }
      // Reaching here means the queue drained without a settling turn - only possible through the
      // abort break or a defensive shift miss; both are cancellations, never completions.
      this.#settle(this.#abortRequested ? { status: "cancelled" } : { status: "interrupted", message: "devin acp input queue ended without a settled turn" })
    } finally {
      this.#pumping = false
    }
  }

  #settle(outcome: RunnerOutcome): void {
    if (this.#lastOutcome !== undefined) return
    this.#lastOutcome = outcome
    this.#outcome.resolve(outcome)
    // The next unsettled cycle gets a fresh deferred; waitForOutcome prefers #lastOutcome while
    // idle, so recreating here never strands a caller holding the just-resolved promise.
    this.#outcome = deferred()
  }

  async #runPrompt(text: string): Promise<TurnObservation> {
    const observation: TurnObservation = { text: "", stopReason: undefined, error: undefined, usage: undefined }
    this.#observation = observation
    this.#emit({ type: "agent_start" })
    this.#emit({
      type: "message_start",
      message: { role: "assistant", content: [], provider: "devin", model: this.#modelId },
    })
    this.#promptActive = true
    try {
      const result = await this.#client.sessionPrompt(this.sessionId, text)
      observation.stopReason = result.stopReason
      observation.usage = usageFromPrompt(result)
    } catch (error) {
      observation.stopReason = "error"
      observation.error = error instanceof Error ? error.message : String(error)
    } finally {
      this.#promptActive = false
      this.#observation = undefined
    }
    this.#lastText = observation.text.length > 0 ? observation.text : this.#lastText
    const stopReason = mapStopReason(observation.stopReason, observation.error)
    this.#emit({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: observation.text }],
        stopReason,
        ...(observation.error === undefined ? {} : { errorMessage: observation.error }),
        provider: "devin",
        model: this.#modelId,
        ...(observation.usage === undefined ? {} : { usage: observation.usage }),
      },
    })
    this.#emit({ type: "agent_end" })
    this.#emit({ type: "agent_idle" })
    return observation
  }

  // ---- session/update -> ManagedChildEvent synthesis ----

  #isSubagentUpdate(update: AcpSessionUpdate): boolean {
    const context = update._meta?.[SUBAGENT_CONTEXT_META]
    if (typeof context !== "object" || context === null) return false
    const parentAgentId = (context as Record<string, unknown>).parentAgentId
    return typeof parentAgentId === "string" && parentAgentId !== "root"
  }

  #onMessageChunk(update: AcpSessionUpdate): void {
    const observation = this.#observation
    if (observation === undefined) return
    const content = update.content
    if (content?.type === "text" && typeof content.text === "string") observation.text += content.text
  }

  #toolName(update: AcpSessionUpdate): string {
    const meta = update._meta
    const inference = meta?.[INFERENCE_TOOL_NAME_META]
    if (typeof inference === "string" && inference.length > 0) return inference
    const started = meta?.[SUBAGENT_STARTED_META]
    if (typeof started === "object" && started !== null) {
      const title = (started as Record<string, unknown>).title
      if (typeof title === "string" && title.length > 0) return `subagent:${title}`
      return "subagent"
    }
    if (typeof update.title === "string" && update.title.length > 0) return update.title
    if (typeof update.kind === "string" && update.kind.length > 0) return update.kind
    return "tool"
  }

  #onToolCall(update: AcpSessionUpdate): void {
    const toolCallId = update.toolCallId
    if (toolCallId === undefined) return
    const state: ToolCallState = { name: this.#toolName(update), started: true, ended: false }
    this.#tools.set(toolCallId, state)
    this.#emit({
      type: "tool_execution_start",
      toolCallId,
      toolName: state.name,
      args: update.rawInput,
    })
    const status = typeof update.status === "string" ? update.status : undefined
    if (status === "completed" || status === "failed" || status === "cancelled") {
      state.ended = true
      this.#emitToolEnd(toolCallId, state, update, status)
    }
  }

  #onToolCallUpdate(update: AcpSessionUpdate): void {
    const toolCallId = update.toolCallId
    if (toolCallId === undefined) return
    let state = this.#tools.get(toolCallId)
    if (state === undefined) {
      state = { name: this.#toolName(update), started: true, ended: false }
      this.#tools.set(toolCallId, state)
      this.#emit({
        type: "tool_execution_start",
        toolCallId,
        toolName: state.name,
        args: update.rawInput,
      })
    }
    const status = typeof update.status === "string" ? update.status : undefined
    if (status !== "completed" && status !== "failed" && status !== "cancelled") return
    if (state.ended) return
    state.ended = true
    this.#emitToolEnd(toolCallId, state, update, status)
  }

  #emitToolEnd(toolCallId: string, state: ToolCallState, update: AcpSessionUpdate, status: string): void {
    const completed = update._meta?.[SUBAGENT_COMPLETED_META]
    const subagentFailed =
      typeof completed === "object" && completed !== null
        ? (completed as Record<string, unknown>).success === false
        : false
    this.#emit({
      type: "tool_execution_end",
      toolCallId,
      toolName: state.name,
      result: update.rawOutput ?? update.content ?? completed,
      isError: status === "failed" || status === "cancelled" || subagentFailed,
    })
  }

  #onUsageUpdate(update: AcpSessionUpdate): void {
    const observation = this.#observation
    const meta = update._meta
    if (observation === undefined || typeof meta !== "object" || meta === null) return
    const input = meta["cognition.ai/inputTokens"]
    const output = meta["cognition.ai/outputTokens"]
    const used = typeof update.used === "number" ? update.used : undefined
    observation.usage = {
      ...(typeof input === "number" ? { input } : {}),
      ...(typeof output === "number" ? { output } : {}),
      ...(used !== undefined || typeof input === "number" || typeof output === "number"
        ? { total: used ?? (typeof input === "number" && typeof output === "number" ? input + output : undefined) }
        : {}),
    }
    // usage_update arrives before the prompt response resolves; the response's own usage wins when
    // present (see usageFromPrompt), so this only backfills turns whose response omits it.
  }

  #onConfigOptionUpdate(update: AcpSessionUpdate): void {
    const options = update.configOptions
    if (!Array.isArray(options)) return
    for (const option of options) {
      if (typeof option !== "object" || option === null) continue
      const record = option as Record<string, unknown>
      if (record.id !== "model") continue
      const current = record.currentValue
      if (typeof current === "string" && current.length > 0) this.#modelId = current
    }
  }

  #emit(event: ManagedChildEvent): void {
    this.#lastSeenValue = Date.now()
    for (const listener of this.#listeners) {
      try {
        listener(event)
      } catch {
        // A transcript/progress listener must never break the child's event pump.
      }
    }
  }
}

function mapStopReason(stopReason: string | undefined, error: string | undefined): string {
  if (error !== undefined) return "error"
  switch (stopReason) {
    case "end_turn":
      return "stop"
    case "cancelled":
      return "aborted"
    case "max_tokens":
      return "length"
    case "refusal":
    case "max_turn_requests":
      return "error"
    default:
      return "stop"
  }
}

function usageFromPrompt(result: AcpPromptResult): TurnObservation["usage"] {
  const usage = result.usage
  if (usage === undefined) return undefined
  const input = typeof usage.inputTokens === "number" ? usage.inputTokens : undefined
  const output = typeof usage.outputTokens === "number" ? usage.outputTokens : undefined
  const total = typeof usage.totalTokens === "number" ? usage.totalTokens : undefined
  if (input === undefined && output === undefined && total === undefined) return undefined
  return {
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
    ...(total === undefined ? {} : { total }),
  }
}

function outcomeForTurn(turn: TurnObservation, modelId: string): RunnerOutcome {
  const model = `devin/${modelId}`
  if (turn.stopReason === "cancelled") {
    return { status: "interrupted", message: "devin acp turn was cancelled" }
  }
  if (turn.stopReason === "error" || turn.error !== undefined) {
    return {
      status: "error",
      model,
      failure: {
        kind: "child-turn-failed",
        message: turn.error ?? `child turn ended with stopReason "${turn.stopReason ?? "unknown"}"`,
      },
    }
  }
  if (turn.text.length > 0) return { status: "completed", finalResponse: turn.text, model }
  return {
    status: "error",
    model,
    failure: { kind: "child-turn-failed", message: "child turn produced no assistant output" },
  }
}

