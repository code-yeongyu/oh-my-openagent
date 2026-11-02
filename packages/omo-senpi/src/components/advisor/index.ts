// Advisor (#12112): a Kibitzer-shaped sidecar for stuck sessions. Hooks record a bounded window of
// the session; every `check_every` tool results a decision model is asked whether the agent is
// wandering, and only above `threshold` a tool-less child on the configured advisor model writes a
// short hint that reaches the session as a hidden steer. Off unless `advisor.enabled` is true.

import { join } from "node:path"

import { resolveOmoAdvisorSettings, type OmoAdvisorSettings, type OmoConfig } from "@oh-my-opencode/omo-config-core"
import type { ChildModelRegistry } from "@oh-my-opencode/senpi-task"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import { loadSenpiOmoConfig } from "../config-resolution"
import { resolveMemoryModelRegistry } from "../memory/model-registry-resolver"
import { runAdvisorChild, type AdvisorChildOutcome, type AdvisorChildSeams } from "./advisor-child"
import { askWanderingGate, type DecisionGateOutcome } from "./decision-gate"
import { renderAdviceMessage } from "./prompt"
import { shouldAskGate } from "./schedule"
import {
  assistantEvent,
  createAdvisorSessionWindow,
  pushAdvisorEvent,
  rememberTask,
  renderAdvisorState,
  textOf,
  toolEvent,
  type AdvisorSessionWindow,
} from "./session-window"

export const ADVISOR_ADVICE_TYPE = "omo-advisor:advice"
export const ADVISOR_GATE_ENTRY_TYPE = "omo-advisor:gate"
const GATE_TIMEOUT_MS = 20_000

export interface AdvisorComponentOptions {
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly loadConfig?: (cwd: string) => OmoConfig
  readonly fetch?: typeof fetch
  readonly runChild?: typeof runAdvisorChild
  readonly childSeams?: AdvisorChildSeams
}

interface SessionRecord {
  readonly settings: OmoAdvisorSettings
  readonly config: OmoConfig
  readonly cwd: string
  readonly window: AdvisorSessionWindow
  registry: ChildModelRegistry | undefined
}

export function createAdvisorComponent(options: AdvisorComponentOptions = {}): OmoSenpiComponent {
  const env = options.env ?? process.env
  const loadConfig = options.loadConfig ?? ((cwd: string) => loadSenpiOmoConfig({ cwd }).config)
  const runChild = options.runChild ?? runAdvisorChild

  return {
    name: "advisor",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      const sessions = new Map<string, SessionRecord | null>()
      const inFlight = new Set<Promise<void>>()

      const recordFor = (eventCtx: unknown): SessionRecord | undefined => {
        const sessionId = sessionIdOf(eventCtx)
        if (sessionId === undefined) return undefined
        const cached = sessions.get(sessionId)
        if (cached !== undefined) return cached ?? undefined
        const cwd = cwdOf(eventCtx) ?? process.cwd()
        let config: OmoConfig
        try {
          config = loadConfig(cwd)
        } catch (error) {
          ctx.logger.warn("omo-senpi advisor config load failed", { error: describe(error) })
          sessions.set(sessionId, null)
          return undefined
        }
        const settings = resolveOmoAdvisorSettings(config)
        const record = settings.enabled ? { settings, config, cwd, window: createAdvisorSessionWindow(), registry: undefined } : null
        sessions.set(sessionId, record)
        return record ?? undefined
      }

      pi.on("before_agent_start", (payload, eventCtx) => {
        if (isRecord(payload) && payload["preview"] === true) return undefined
        const record = recordFor(eventCtx)
        if (record !== undefined && isRecord(payload) && typeof payload["prompt"] === "string") rememberTask(record.window, payload["prompt"])
        return undefined
      }, { previewSafe: true })

      pi.on("message_end", (payload, eventCtx) => {
        const record = recordFor(eventCtx)
        if (record === undefined || !isRecord(payload) || !isRecord(payload["message"])) return
        const message = payload["message"]
        if (message["role"] !== "assistant") return
        const text = textOf(message["content"]).trim()
        if (text.length > 0) pushAdvisorEvent(record.window, assistantEvent(text), record.settings.window)
      })

      pi.on("tool_result", (payload, eventCtx) => {
        const record = recordFor(eventCtx)
        if (record === undefined || !isRecord(payload) || typeof payload["toolName"] !== "string") return undefined
        const registry = resolveMemoryModelRegistry(eventCtx)
        if (registry !== undefined) record.registry = registry
        const window = record.window
        pushAdvisorEvent(window, toolEvent(payload["toolName"], payload["input"], payload["isError"] === true, payload["content"]), record.settings.window)
        window.toolResults += 1
        if (!shouldAskGate(window, record.settings)) return undefined
        const sessionId = sessionIdOf(eventCtx)
        if (sessionId === undefined) return undefined
        window.inFlight = true
        window.lastGateAt = window.toolResults
        const task = consult(sessionId, record).finally(() => {
          window.inFlight = false
          inFlight.delete(task)
        })
        inFlight.add(task)
        return undefined
      })

      pi.on("session_shutdown", (_payload, eventCtx) => {
        const sessionId = sessionIdOf(eventCtx)
        if (sessionId !== undefined) sessions.delete(sessionId)
      })

      async function consult(sessionId: string, record: SessionRecord): Promise<void> {
        const { settings, window } = record
        const state = renderAdvisorState(window)
        const gate: DecisionGateOutcome = await askWanderingGate({
          url: settings.decision_url,
          model: settings.decision_model,
          apiKey: env[settings.api_key_env],
          state,
          timeoutMs: GATE_TIMEOUT_MS,
          ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        })
        const atToolResult = window.toolResults
        if (gate.kind !== "scored") {
          ctx.logger.warn("omo-senpi advisor gate unavailable", { sessionId, outcome: gate.kind, ...("reason" in gate ? { reason: gate.reason } : {}) })
          pi.appendEntry?.(ADVISOR_GATE_ENTRY_TYPE, { version: 1, atToolResult, gate })
          return
        }
        const triggered = gate.probability >= settings.threshold && window.advices < settings.max_per_session
        if (!triggered) {
          pi.appendEntry?.(ADVISOR_GATE_ENTRY_TYPE, { version: 1, atToolResult, gate, triggered: false })
          return
        }
        window.advices += 1
        window.lastAdviceAt = atToolResult
        const outcome: AdvisorChildOutcome = await runChild({
          sessionId,
          sequence: window.advices,
          cwd: record.cwd,
          sessionDir: join(resolveAgentHome({ env }), "advisor", encodeURIComponent(sessionId)),
          agentDir: resolveAgentHome({ env }),
          model: settings.model,
          category: settings.category,
          config: record.config,
          registry: record.registry,
          state,
          timeoutMs: settings.timeout_seconds * 1000,
        }, options.childSeams)
        if (outcome.kind === "advice") {
          await pi.sendMessage(
            { customType: ADVISOR_ADVICE_TYPE, content: renderAdviceMessage(outcome.text), display: false, details: { model: outcome.model, probability: gate.probability } },
            { deliverAs: "steer" },
          )
          ctx.logger.info("omo-senpi advisor advice delivered", { sessionId, model: outcome.model, probability: gate.probability })
        } else {
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
