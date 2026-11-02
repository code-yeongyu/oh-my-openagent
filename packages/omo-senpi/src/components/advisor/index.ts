// Advisor (#12112): a Kibitzer-shaped sidecar for stuck sessions. Hooks record a bounded window of
// tool calls; from `min_calls` on, a decision model judges after each `check_every` tool results
// whether the agent is stuck and how. Only when it is (stuck >= `threshold`, a named kind, a confident
// label) a tool-less child on the advisor model writes a plan, which reaches the session as a hidden
// steer message. Off unless `advisor.enabled` is true.

import { join } from "node:path"

import { LATEST_MODEL_BY_FAMILY } from "@oh-my-opencode/model-core/latest-models"
import { resolveOmoAdvisorSettings, type OmoAdvisorSettings, type OmoConfig } from "@oh-my-opencode/omo-config-core"
import type { ChildModelRegistry } from "@oh-my-opencode/senpi-task"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import { loadSenpiOmoConfig } from "../config-resolution"
import { resolveMemoryModelRegistry } from "../memory/model-registry-resolver"
import { runAdvisorChild, type AdvisorChildOutcome, type AdvisorChildSeams } from "./advisor-child"
import { askDecisionGate, buildGateState, gateFires } from "./decision-gate"
import { ADVISOR_DELIVERY_ENTRY_TYPE, deliverHeldPlan, dropHeldPlan, type HeldPlan } from "./plan-delivery"
import { renderAdviceMessage, renderAdvisorPrompt } from "./prompt"
import { shouldAskGate } from "./schedule"
import { createAdvisorSessionWindow, recordToolResult, rememberTask, textOf, type AdvisorSessionWindow } from "./session-window"

export { ADVISOR_ADVICE_TYPE, ADVISOR_DELIVERY_ENTRY_TYPE } from "./plan-delivery"
export const ADVISOR_GATE_ENTRY_TYPE = "omo-advisor:gate"
const GATE_TIMEOUT_MS = 20_000
const DEFAULT_ADVISOR_MODEL = `anthropic/${LATEST_MODEL_BY_FAMILY.claudeOpus}`

export interface AdvisorComponentOptions {
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly loadConfig?: (cwd: string) => OmoConfig
  readonly fetch?: typeof fetch
  readonly runChild?: typeof runAdvisorChild
  readonly childSeams?: AdvisorChildSeams
  readonly now?: () => number
}

interface SessionRecord {
  readonly settings: OmoAdvisorSettings
  readonly config: OmoConfig
  readonly cwd: string
  readonly window: AdvisorSessionWindow
  readonly shutdown: AbortController
  registry: ChildModelRegistry | undefined
  heldPlan: HeldPlan | undefined
}

export function createAdvisorComponent(options: AdvisorComponentOptions = {}): OmoSenpiComponent {
  const env = options.env ?? process.env
  const loadConfig = options.loadConfig ?? ((cwd: string) => loadSenpiOmoConfig({ cwd }).config)
  const runChild = options.runChild ?? runAdvisorChild
  const now = options.now ?? Date.now
  // Off registers no hook at all: every registered tool_result handler shows up as a PostToolUse
  // hook run on every tool call of every session, so a disabled advisor must not exist there.
  const enabledAtStartup = (cwd: string): boolean => {
    try {
      return resolveOmoAdvisorSettings(loadConfig(cwd)).enabled
    } catch {
      return false
    }
  }

  return {
    name: "advisor",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      if (!enabledAtStartup(pi.cwd ?? process.cwd())) return
      const sessions = new Map<string, SessionRecord | null>()

      const recordFor = (eventCtx: unknown): SessionRecord | undefined => {
        const sessionId = sessionIdOf(eventCtx)
        if (sessionId === undefined) return undefined
        const cached = sessions.get(sessionId)
        if (cached !== undefined) return cached ?? undefined
        const cwd = cwdOf(eventCtx) ?? process.cwd()
        let settings: OmoAdvisorSettings
        let config: OmoConfig
        try {
          config = loadConfig(cwd)
          settings = resolveOmoAdvisorSettings(config)
        } catch (error) {
          ctx.logger.warn("omo-senpi advisor config load failed", { error: describe(error) })
          sessions.set(sessionId, null)
          return undefined
        }
        const record = settings.enabled
          ? { settings, config, cwd, window: createAdvisorSessionWindow(now()), shutdown: new AbortController(), registry: undefined, heldPlan: undefined }
          : null
        sessions.set(sessionId, record)
        return record ?? undefined
      }

      pi.on("before_agent_start", (payload, eventCtx) => {
        if (isRecord(payload) && payload["preview"] === true) return undefined
        const record = recordFor(eventCtx)
        if (record === undefined || !isRecord(payload) || typeof payload["prompt"] !== "string") return undefined
        dropHeldPlan(pi, record, "new_prompt")
        record.window.promptGeneration += 1
        rememberTask(record.window, payload["prompt"])
        return undefined
      }, { previewSafe: true })

      pi.on("agent_settled", (_payload, eventCtx) => {
        const sessionId = sessionIdOf(eventCtx)
        const record = sessionId === undefined ? undefined : sessions.get(sessionId)
        if (record) dropHeldPlan(pi, record, "settled")
      })

      pi.on("message_end", (payload, eventCtx) => {
        const record = recordFor(eventCtx)
        if (record === undefined || !isRecord(payload) || !isRecord(payload["message"])) return
        if (payload["message"]["role"] === "assistant" && textOf(payload["message"]["content"]).trim().length > 0) record.window.lastMessageAt = now()
      })

      pi.on("tool_result", (payload, eventCtx) => {
        const record = recordFor(eventCtx)
        const sessionId = sessionIdOf(eventCtx)
        if (record === undefined || sessionId === undefined || !isRecord(payload) || typeof payload["toolName"] !== "string") return undefined
        const registry = resolveMemoryModelRegistry(eventCtx)
        if (registry !== undefined) record.registry = registry
        const window = record.window
        recordToolResult(window, payload["toolName"], payload["input"], payload["isError"] === true, payload["content"], record.settings.window)
        void deliverHeldPlan(pi, record, eventCtx, ctx.logger)
          .catch((error: unknown) => ctx.logger.warn("omo-senpi advisor delivery failed", { sessionId, error: describe(error) }))
        if (record.heldPlan !== undefined || !shouldAskGate(window, record.settings)) return undefined
        window.inFlight = true
        void consult(sessionId, record)
          .catch((error: unknown) => ctx.logger.warn("omo-senpi advisor consult failed", { sessionId, error: describe(error) }))
          .finally(() => {
            window.inFlight = false
          })
        return undefined
      })

      pi.on("session_shutdown", (_payload, eventCtx) => {
        const sessionId = sessionIdOf(eventCtx)
        if (sessionId === undefined) return
        sessions.get(sessionId)?.shutdown.abort()
        sessions.delete(sessionId)
      })

      async function consult(sessionId: string, record: SessionRecord): Promise<void> {
        const { settings, window } = record
        const atToolResult = window.toolResults
        const generation = window.promptGeneration
        const gate = await askDecisionGate({
          url: settings.decision_url,
          model: settings.decision_model,
          apiKey: env[settings.api_key_env],
          state: buildGateState(window, now()),
          timeoutMs: GATE_TIMEOUT_MS,
          signal: record.shutdown.signal,
          ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        })
        if (record.shutdown.signal.aborted) return
        if (gate.kind !== "judged") {
          window.lastAdviceAt = atToolResult
          if (!window.gateMissWarned) {
            window.gateMissWarned = true
            ctx.logger.warn("omo-senpi advisor gate unavailable", { sessionId, outcome: gate.kind, ...("reason" in gate ? { reason: gate.reason } : {}) })
            pi.appendEntry?.(ADVISOR_GATE_ENTRY_TYPE, { version: 1, atToolResult, gate })
          }
          return
        }
        if (!gateFires(gate, settings.threshold, settings.kind_confidence) || window.advices >= settings.max_per_session) {
          pi.appendEntry?.(ADVISOR_GATE_ENTRY_TYPE, { version: 1, atToolResult, gate, triggered: false })
          return
        }
        window.advices += 1
        const judgement = { trouble: gate.trouble, stuck: gate.stuck }
        const agentDir = resolveAgentHome({ env })
        const outcome: AdvisorChildOutcome = await runChild({
          sessionId,
          sequence: window.advices,
          cwd: record.cwd,
          sessionDir: join(agentDir, "advisor", encodeURIComponent(sessionId)),
          agentDir,
          model: settings.model ?? DEFAULT_ADVISOR_MODEL,
          thinking: settings.thinking,
          category: settings.category,
          config: record.config,
          registry: record.registry,
          prompt: renderAdvisorPrompt(window, judgement),
          timeoutMs: settings.timeout_seconds * 1000,
          signal: record.shutdown.signal,
        }, options.childSeams)
        if (record.shutdown.signal.aborted) return
        if (outcome.kind === "advice" && window.promptGeneration !== generation) {
          pi.appendEntry?.(ADVISOR_DELIVERY_ENTRY_TYPE, { version: 1, delivered: false, reason: "stale_prompt", firedAt: atToolResult })
        } else if (outcome.kind === "advice") {
          record.heldPlan = { content: renderAdviceMessage(outcome.text, judgement), model: outcome.model, judgement, firedAt: atToolResult }
        } else {
          window.lastAdviceAt = atToolResult
          ctx.logger.warn("omo-senpi advisor child produced no advice", { sessionId, outcome: outcome.kind, reason: outcome.reason })
        }
        pi.appendEntry?.(ADVISOR_GATE_ENTRY_TYPE, { version: 1, atToolResult, gate, triggered: true, advice: outcome })
      }
    },
  }
}

function sessionIdOf(eventCtx: unknown): string | undefined {
  if (!isRecord(eventCtx) || !isRecord(eventCtx["sessionManager"])) return undefined
  const getSessionId = eventCtx["sessionManager"]["getSessionId"]
  if (typeof getSessionId !== "function") return undefined
  const id: unknown = getSessionId.call(eventCtx["sessionManager"])
  return typeof id === "string" && id.length > 0 ? id : undefined
}

function cwdOf(eventCtx: unknown): string | undefined {
  return isRecord(eventCtx) && typeof eventCtx["cwd"] === "string" ? eventCtx["cwd"] : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
