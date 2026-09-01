import type { EventTelemetryClient, EventTelemetryProperties } from "@oh-my-opencode/telemetry-core"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import {
  armingSnapshot,
  classifyUltraworkInput,
  type UltraworkClassification,
} from "../ultrawork/index"
import { hashSessionId, OMO_NATIVE_PROPERTY_ALLOWLISTS } from "./product-identity"

type InputSource = "interactive" | "rpc" | "extension"
type StreamingBehavior = "steer" | "followUp"
type Disposition = "queued" | "started" | "handled" | "rejected"
type PromptClient = Pick<EventTelemetryClient, "captureEvent">
type PromptProperty = (typeof OMO_NATIVE_PROPERTY_ALLOWLISTS.prompt_submitted)[number]

type PendingPrompt = {
  readonly classification: UltraworkClassification
  readonly inputSource: InputSource
  readonly ordinalBucket: string
  readonly promptLengthBucket: string
  readonly sessionHash: string
  readonly streamingBehavior?: StreamingBehavior
}

export type OmoNativePromptComponentOptions = {
  readonly client: PromptClient
  readonly hashSessionId?: (sessionId: string) => string
}

export function createOmoNativePromptComponent(options: OmoNativePromptComponentOptions): OmoSenpiComponent {
  return {
    name: "telemetry",
    register(pi: SenpiExtensionAPI, _ctx: ComponentContext): void {
      const pending = new Map<string, PendingPrompt>()
      const completed = new Set<string>()
      const realPromptOrdinals = new Map<string, number>()
      const hash = options.hashSessionId ?? hashSessionId

      pi.on("input", (payload: unknown, eventCtx: unknown): { action: "continue" } => {
        const input = parseInput(payload)
        if (input === undefined || completed.has(input.inputId) || pending.has(input.inputId)) {
          return { action: "continue" }
        }

        const sessionId = extractSessionId(eventCtx) ?? "anonymous"
        const snapshot = armingSnapshot(sessionId)
        const classification = classifyUltraworkInput({ text: input.text, source: input.source }, snapshot)
        const ordinal = nextRealPromptOrdinal(realPromptOrdinals, sessionId, input.source)
        pending.set(input.inputId, {
          classification,
          inputSource: input.source,
          ordinalBucket: ordinalBucket(ordinal),
          promptLengthBucket: lengthBucket(input.text.length),
          sessionHash: hash(sessionId),
          streamingBehavior: input.streamingBehavior,
        })
        return { action: "continue" }
      })

      pi.on("input_disposition", (payload: unknown): void => {
        const event = parseDisposition(payload)
        if (event === undefined) return
        emit(event.inputId, event.disposition)
      })

      pi.on("session_shutdown", (): void => {
        for (const inputId of [...pending.keys()]) emit(inputId, undefined)
      })

      const emit = (inputId: string, disposition: Disposition | undefined): void => {
        const prompt = pending.get(inputId)
        if (prompt === undefined || completed.has(inputId)) return
        pending.delete(inputId)
        completed.add(inputId)
        options.client.captureEvent("prompt_submitted", properties(prompt, disposition))
      }
    },
  }
}

function properties(prompt: PendingPrompt, disposition: Disposition | undefined): EventTelemetryProperties {
  const classification = prompt.classification
  return {
    $session_id: prompt.sessionHash,
    input_source: prompt.inputSource,
    invocation_stage: classification.stage,
    is_effective_ultrawork_invocation: classification.effective,
    is_real_user_prompt: prompt.inputSource !== "extension",
    is_turn_start: disposition === "started",
    keyword_any: classification.matchedUlw || classification.matchedUltrawork,
    keyword_occurrence_bucket: occurrenceBucket(classification.occurrenceCount),
    keyword_ultrawork_full: classification.matchedUltrawork,
    keyword_ulw_abbrev: classification.matchedUlw,
    keyword_variant: keywordVariant(classification),
    prompt_length_bucket: prompt.promptLengthBucket,
    queue_mode: queueMode(disposition, prompt.streamingBehavior),
    real_prompt_ordinal_bucket: prompt.ordinalBucket,
    suppression_reason: classification.suppressionReason,
  } satisfies Record<PromptProperty, string | boolean>
}

function parseInput(value: unknown): {
  inputId: string
  text: string
  source: InputSource
  streamingBehavior?: StreamingBehavior
} | undefined {
  if (!isRecord(value) || value["type"] !== "input") return undefined
  const inputId = value["inputId"]
  const text = value["text"]
  const source = value["source"]
  if (typeof inputId !== "string" || inputId.length === 0 || typeof text !== "string" || !isInputSource(source)) return undefined
  const streamingBehavior = value["streamingBehavior"]
  return {
    inputId,
    text,
    source,
    ...(streamingBehavior === "steer" || streamingBehavior === "followUp" ? { streamingBehavior } : {}),
  }
}

function parseDisposition(value: unknown): { inputId: string; disposition: Disposition } | undefined {
  if (!isRecord(value) || value["type"] !== "input_disposition") return undefined
  const inputId = value["inputId"]
  const disposition = value["disposition"]
  if (typeof inputId !== "string" || !isDisposition(disposition)) return undefined
  return { inputId, disposition }
}

function nextRealPromptOrdinal(ordinals: Map<string, number>, sessionId: string, source: InputSource): number {
  const current = ordinals.get(sessionId) ?? 0
  if (source === "extension") return Math.max(1, current)
  const next = current + 1
  ordinals.set(sessionId, next)
  return next
}

function occurrenceBucket(count: number): string {
  if (count <= 1) return "1"
  if (count === 2) return "2"
  return count <= 5 ? "3_5" : "6_plus"
}

function lengthBucket(length: number): string {
  if (length < 100) return "lt_100"
  if (length < 500) return "100_500"
  return length < 2_000 ? "500_2000" : "gte_2000"
}

function ordinalBucket(ordinal: number): string {
  if (ordinal === 1) return "1"
  if (ordinal <= 3) return "2_3"
  if (ordinal <= 10) return "4_10"
  if (ordinal <= 25) return "11_25"
  return "26_plus"
}

function queueMode(disposition: Disposition | undefined, streamingBehavior: StreamingBehavior | undefined): string {
  if (disposition === "started") return "immediate"
  if (disposition === "queued") {
    if (streamingBehavior === "followUp") return "follow_up"
    if (streamingBehavior === "steer") return "steer"
  }
  return "other"
}

function keywordVariant(classification: UltraworkClassification): string {
  if (classification.matchedUlw && classification.matchedUltrawork) return "both"
  if (classification.matchedUlw) return "ulw"
  if (classification.matchedUltrawork) return "ultrawork"
  return "none"
}

function extractSessionId(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value["sessionManager"])) return undefined
  const manager = value["sessionManager"]
  const getter = manager["getSessionId"]
  if (typeof getter !== "function") return undefined
  const sessionId: unknown = getter.call(manager)
  return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : undefined
}

function isInputSource(value: unknown): value is InputSource {
  return value === "interactive" || value === "rpc" || value === "extension"
}

function isDisposition(value: unknown): value is Disposition {
  return value === "queued" || value === "started" || value === "handled" || value === "rejected"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
