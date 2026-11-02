// The gate asks a `/v1/decisions` endpoint (the request shape TypeSafe Jev and the gateways that
// front it accept: `state` plus a `questions` map) two typed questions: how likely the agent is stuck
// (`noul`) and which way (`choice`). The decision model only decides; it never writes the advice.
// Every failure resolves to a typed outcome; the caller never sees a throw.

import { trailingRun, type AdvisorSessionWindow } from "./session-window"

const GATE_CALLS = 8
const GATE_TASK_CHARS = 800
const GATE_ARGS_CHARS = 160
const GATE_RESULT_TAIL = 240

const TROUBLE_KINDS = ["same_call", "repoll_unchanged", "wait_misuse", "error_streak", "wandering", "none"] as const
export type TroubleKind = (typeof TROUBLE_KINDS)[number]

const GATE_QUESTIONS = {
  stuck: {
    type: "noul",
    instructions:
      "Reading `recent_calls` (oldest first) against `task`, is the agent stuck rather than making progress: repeating a call or read that returns the same thing, polling for a change that has not come, hitting the same error again, acting without reading the error it just got, or doing work the task did not ask for?",
    criteria: {
      true: "the last few calls add no new information or no new change toward the task, and the same outcome recurs",
      false: "each recent call advances the task with a distinct input or a changed approach, or a legitimate batch runs over different files or inputs",
    },
  },
  kind: {
    type: "choice",
    instructions: "Which pattern best describes the agent's last few calls in `recent_calls`? Pick `none` when the agent is progressing.",
    criteria: {
      same_call: "the same tool with the same arguments repeated",
      repoll_unchanged: "the same file, process or command re-read and unchanged",
      wait_misuse: "sleeping or polling (bash_output, task_output, sleep) instead of waiting for an event",
      error_streak: "consecutive errors with no change of approach between them",
      wandering: "edits or commands outside what the task asked for, or exploration with no check against the task",
      none: "progressing",
    },
  },
} as const

export interface GateState {
  readonly task: string
  readonly recent_calls: readonly { readonly tool: string; readonly args: string; readonly result_tail: string; readonly is_error: boolean }[]
  readonly seconds_since_last_message: number
  readonly counts: { readonly identical_run: number; readonly same_resource_unchanged: number; readonly poll_calls_in_window: number; readonly error_run: number }
}

export function buildGateState(window: AdvisorSessionWindow, now: number): GateState {
  const recent = window.calls.slice(-GATE_CALLS)
  const last = recent[recent.length - 1]
  return {
    task: (window.task ?? "(unknown)").slice(0, GATE_TASK_CHARS),
    recent_calls: recent.map((call) => ({
      tool: call.tool,
      args: call.args.slice(0, GATE_ARGS_CHARS),
      result_tail: call.result.slice(-GATE_RESULT_TAIL),
      is_error: call.isError,
    })),
    seconds_since_last_message: Math.max(0, Math.round((now - window.lastMessageAt) / 1000)),
    counts: {
      identical_run: trailingRun(window.calls, (a, b) => a.tool === b.tool && a.args === b.args),
      same_resource_unchanged: last === undefined ? 0 : recent.filter((call) => call.tool === last.tool && call.args === last.args && call.result === last.result).length,
      poll_calls_in_window: recent.filter((call) => call.isWait).length,
      error_run: trailingRun(window.calls, (a) => a.isError),
    },
  }
}

export type DecisionGateOutcome =
  | { readonly kind: "judged"; readonly stuck: number; readonly trouble: TroubleKind; readonly confidence: number; readonly inputTokens?: number }
  | { readonly kind: "no_key" }
  | { readonly kind: "failed"; readonly reason: string }

export interface DecisionGateRequest {
  readonly url: string
  readonly model: string
  readonly apiKey: string | undefined
  readonly state: GateState
  readonly timeoutMs: number
  readonly signal?: AbortSignal
  readonly fetch?: typeof fetch
}

export async function askDecisionGate(request: DecisionGateRequest): Promise<DecisionGateOutcome> {
  if (request.apiKey === undefined || request.apiKey.length === 0) return { kind: "no_key" }
  const fetchImpl = request.fetch ?? fetch
  let response: Response
  try {
    response = await fetchImpl(request.url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${request.apiKey}` },
      body: JSON.stringify({ model: request.model, state: request.state, questions: GATE_QUESTIONS }),
      signal: request.signal === undefined ? AbortSignal.timeout(request.timeoutMs) : AbortSignal.any([AbortSignal.timeout(request.timeoutMs), request.signal]),
    })
  } catch (error) {
    return { kind: "failed", reason: error instanceof Error ? error.name : "fetch_failed" }
  }
  if (!response.ok) return { kind: "failed", reason: `http_${response.status}` }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { kind: "failed", reason: "invalid_json" }
  }
  return parseGateAnswers(body)
}

export function parseGateAnswers(body: unknown): DecisionGateOutcome {
  if (!isRecord(body) || !isRecord(body["answers"])) return { kind: "failed", reason: "no_answers" }
  const stuck = body["answers"]["stuck"]
  const kind = body["answers"]["kind"]
  if (!isRecord(stuck) || !isProbability(stuck["noul"])) return { kind: "failed", reason: "invalid_stuck" }
  if (!isRecord(kind) || !isTroubleKind(kind["choice"])) return { kind: "failed", reason: "invalid_kind" }
  const confidence = isProbability(kind["confidence"]) ? kind["confidence"] : 0
  const usage = body["usage"]
  const inputTokens = isRecord(usage) && typeof usage["input_tokens"] === "number" ? usage["input_tokens"] : undefined
  const judged = { kind: "judged" as const, stuck: stuck["noul"], trouble: kind["choice"], confidence }
  return inputTokens === undefined ? judged : { ...judged, inputTokens }
}

export function gateFires(outcome: DecisionGateOutcome, threshold: number, minConfidence: number): boolean {
  return outcome.kind === "judged" && outcome.stuck >= threshold && outcome.trouble !== "none" && outcome.confidence >= minConfidence
}

function isProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
}

function isTroubleKind(value: unknown): value is TroubleKind {
  return typeof value === "string" && (TROUBLE_KINDS as readonly string[]).includes(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
