import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { readAgentEndOutcome } from "../ulw-execute-continuation/agent-end-eligibility"
import type { ClaimVerdict } from "./match"
import { type ClaimReceiptRuntimeLoader, claimReceiptRuntimeLoadFailure, loadClaimReceiptRuntime } from "./runtime-loader"
import { GATE_FLAGS_TAG, gateFlagsBlock, NUDGE_MESSAGE_TYPE, nudgeText, VERDICT_ENTRY_TYPE, type VerdictRecord } from "./verdict"

export const CLAIM_RECEIPT_NUDGE_FLAG = "omo-senpi-claim-receipt-nudge"

const GATE_REVIEWER = /(?:^|-)gate-reviewer$/
const MEMORY_CHILD_SENTINELS = ["SENPI_MEMORY_REFLECTION", "SENPI_MEMORY_FACTS"] as const
const MAX_GATE_FLAGS = 20

type Rec = Record<string, unknown>
const isRecord = (value: unknown): value is Rec => typeof value === "object" && value !== null && !Array.isArray(value)

interface SessionState {
  epoch: number
  nudgedEpoch: number
  agentEnd: unknown
  flagged: ClaimVerdict[]
}

function sessionManagerOf(eventCtx: unknown): Rec | undefined {
  return isRecord(eventCtx) && isRecord(eventCtx["sessionManager"]) ? eventCtx["sessionManager"] : undefined
}

function callManager(eventCtx: unknown, method: "getSessionId" | "getBranch"): unknown {
  const manager = sessionManagerOf(eventCtx)
  const fn = manager?.[method]
  return manager !== undefined && typeof fn === "function" ? Reflect.apply(fn, manager, []) : undefined
}

function lastAssistantIndex(branch: readonly unknown[]): number {
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index]
    if (isRecord(entry) && entry["type"] === "message" && isRecord(entry["message"]) && entry["message"]["role"] === "assistant") return index
  }
  return -1
}

export interface ClaimReceiptComponentOptions {
  readonly loadRuntime?: ClaimReceiptRuntimeLoader
}

export function createClaimReceiptComponent(
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: ClaimReceiptComponentOptions = {},
): OmoSenpiComponent {
  const loadRuntime = options.loadRuntime ?? loadClaimReceiptRuntime
  return {
    name: "claim-receipt",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      // Shadow mode by default: verdicts are recorded and logged, but nothing reaches the agent until replay precision
      // on hand-labelled flags reaches 70% (#10802 tracks the false-positive classes still in the way).
      pi.registerFlag(CLAIM_RECEIPT_NUDGE_FLAG, {
        type: "boolean",
        default: false,
        description: "Show the unsupported-claim nudge and pass flagged claims to gate reviewers. Off by default: verdicts are only recorded.",
      })
      const surfaced = (): boolean => ctx.config.getFlag(CLAIM_RECEIPT_NUDGE_FLAG) === true
      let loadFailureReported = false
      const sessions = new Map<string, SessionState>()
      const keyOf = (eventCtx: unknown): string => {
        const id = callManager(eventCtx, "getSessionId")
        return typeof id === "string" && id.length > 0 ? id : "anonymous"
      }
      const stateOf = (eventCtx: unknown): SessionState => {
        const key = keyOf(eventCtx)
        const existing = sessions.get(key)
        if (existing !== undefined) return existing
        const created: SessionState = { epoch: 0, nudgedEpoch: -1, agentEnd: undefined, flagged: [] }
        sessions.set(key, created)
        return created
      }

      pi.on("input", (payload: unknown, eventCtx: unknown) => {
        if (isRecord(payload) && payload["source"] === "extension") return { action: "continue" }
        const state = stateOf(eventCtx)
        state.epoch += 1
        state.flagged = []
        return { action: "continue" }
      })

      pi.on("agent_end", (payload: unknown, eventCtx: unknown): void => {
        stateOf(eventCtx).agentEnd = payload
      })

      pi.on("agent_before_settle", async (payload: unknown, eventCtx: unknown) => {
        if (!isRecord(payload) || payload["outcome"] !== "completed") return undefined
        if (MEMORY_CHILD_SENTINELS.some((name) => env[name] === "1")) return undefined
        const state = stateOf(eventCtx)
        const ended = state.agentEnd
        state.agentEnd = undefined
        if (readAgentEndOutcome(ended).blockedBy !== null) return undefined
        const branch = callManager(eventCtx, "getBranch")
        if (!Array.isArray(branch)) return undefined
        const answerAt = lastAssistantIndex(branch)
        const answerEntry: unknown = branch[answerAt]
        if (!isRecord(answerEntry) || !isRecord(answerEntry["message"])) return undefined
        const content = answerEntry["message"]["content"]
        if (Array.isArray(content) && content.some((part) => isRecord(part) && part["type"] === "toolCall")) return undefined
        // The first sidecar import is a real await: a user message can arrive during it. This answer belongs to the
        // epoch it ended in, so a newer message must neither inherit its flags nor lose its own nudge.
        const epoch = state.epoch
        let runtime: Awaited<ReturnType<ClaimReceiptRuntimeLoader>>
        try {
          runtime = await loadRuntime()
          loadFailureReported = false
        } catch (error) {
          if (!loadFailureReported) ctx.logger.warn(claimReceiptRuntimeLoadFailure(error))
          loadFailureReported = true
          return undefined
        }
        const evaluated = runtime.evaluateAnswer(branch, answerAt, content)
        if (evaluated === undefined) return undefined
        const { verdicts, flagged } = evaluated
        const current = state.epoch === epoch
        const nudged = current && flagged.length > 0 && state.nudgedEpoch !== epoch && surfaced()
        if (nudged) state.nudgedEpoch = epoch
        if (current) state.flagged = [...state.flagged, ...flagged].slice(-MAX_GATE_FLAGS)
        const answerEntryId = typeof answerEntry["id"] === "string" ? answerEntry["id"] : ""
        const record: VerdictRecord = { version: 1, answerEntryId, epoch, flagged: flagged.length > 0, nudged, verdicts }
        const drafts: Rec[] = [{ type: "custom", customType: VERDICT_ENTRY_TYPE, data: record }]
        if (nudged) drafts.push({ type: "custom_message", customType: NUDGE_MESSAGE_TYPE, content: nudgeText(flagged), display: true, details: { answerEntryId, flagged } })
        if (flagged.length > 0) ctx.logger.info("omo-senpi claim-receipt flagged unsupported claims", { count: flagged.length, nudged })
        const existing = Array.isArray(payload["entries"]) ? payload["entries"] : []
        return { entries: [...existing, ...drafts] }
      })

      pi.on("tool_call", (payload: unknown, eventCtx: unknown): undefined => {
        if (!surfaced() || !isRecord(payload) || payload["toolName"] !== "task" || !isRecord(payload["input"])) return undefined
        const flagged = sessions.get(keyOf(eventCtx))?.flagged ?? []
        if (flagged.length === 0) return undefined
        const input = payload["input"]
        const items = Array.isArray(input["tasks"]) ? input["tasks"].filter(isRecord) : []
        for (const target of [input, ...items]) {
          const agent = target["subagent_type"] ?? input["subagent_type"]
          const prompt = target["prompt"]
          if (typeof agent !== "string" || !GATE_REVIEWER.test(agent) || typeof prompt !== "string") continue
          if (prompt.includes(`<${GATE_FLAGS_TAG}>`)) continue
          target["prompt"] = `${prompt}\n\n${gateFlagsBlock(flagged)}`
        }
        return undefined
      })

      pi.on("session_compact", (payload: unknown, eventCtx: unknown): void => {
        if (isRecord(payload) && payload["accepted"] === false) return
        stateOf(eventCtx).nudgedEpoch = -1
      })

      pi.on("session_shutdown", (_payload: unknown, eventCtx: unknown): void => {
        sessions.delete(keyOf(eventCtx))
      })
    },
  }
}
