import { join } from "node:path"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { findContinuableBoulderWork } from "./boulder-eligibility"

export interface StartWorkContinuationComponentOptions {
  // none yet; retained for future DI seams
}

const CONTINUATION_LIMIT = 8

const START_WORK_STEERING_REMINDER = [
  "<omo-senpi-start-work>",
  "An active Prometheus start-work plan is present in this working directory.",
  "Before continuing, read `.omo/boulder.json` and the active plan file to determine what remains; use the ledger and plan as the source of truth.",
  "Continue the current work with evidence-bound execution; do not start unrelated work until every top-level checkbox is `- [x]`.",
  "</omo-senpi-start-work>",
].join("\n")

interface InputEventLike {
  text: string
  source?: unknown
  images?: unknown
}

interface SessionManagerLike {
  getSessionId(): string | undefined
}

interface AgentEndEventCtx {
  cwd?: unknown
  sessionManager?: SessionManagerLike
}

export function createStartWorkContinuationComponent(
  _options: StartWorkContinuationComponentOptions = {},
): OmoSenpiComponent {
  return {
    name: "start-work-continuation",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      const state = {
        consecutiveContinuations: 0,
        lastSignature: undefined as string | undefined,
      }

      pi.on("input", async (payload, eventCtx) => {
        if (!isInputEvent(payload)) return { action: "continue" }
        if (!isUserSourcedInput(payload)) return { action: "continue" }

        state.consecutiveContinuations = 0
        state.lastSignature = undefined

        const sessionId = extractSessionId(eventCtx)
        const cwd = extractCwd(eventCtx)
        if (!sessionId || !cwd) return { action: "continue" }

        const continuable = findContinuableBoulderWork(cwd, sessionId)
        if (!continuable) return { action: "continue" }

        return {
          action: "transform",
          text: `${payload.text}\n\n${START_WORK_STEERING_REMINDER}`,
          ...(Array.isArray(payload.images) ? { images: payload.images } : {}),
        }
      })

      pi.on("agent_end", async (_payload, eventCtx) => {
        if (state.consecutiveContinuations >= CONTINUATION_LIMIT) {
          ctx.logger.info("omo-senpi start-work-continuation skipped", {
            reason: "continuation-cap-reached",
            count: state.consecutiveContinuations,
          })
          return
        }

        const sessionId = extractSessionId(eventCtx)
        const cwd = extractCwd(eventCtx)
        if (!sessionId || !cwd) {
          ctx.logger.info("omo-senpi start-work-continuation skipped", { reason: "missing-context" })
          return
        }

        const continuable = findContinuableBoulderWork(cwd, sessionId)
        if (!continuable) {
          state.lastSignature = undefined
          ctx.logger.info("omo-senpi start-work-continuation skipped", { reason: "not-continuable" })
          return
        }

        const { work, planPath, checklist } = continuable
        const signature = `${work.work_id}:${work.updated_at ?? work.started_at}:${checklist.completed}/${checklist.total}`
        if (state.lastSignature === signature) {
          ctx.logger.info("omo-senpi start-work-continuation skipped", { reason: "stale-signature" })
          return
        }

        state.lastSignature = signature
        state.consecutiveContinuations += 1

        const content = renderDirective({
          planName: work.plan_name,
          planPath,
          boulderPath: join(cwd, ".omo", "boulder.json"),
          ledgerPath: join(cwd, ".omo", "start-work", "ledger.jsonl"),
          checklist,
          worktreePath: work.worktree_path ?? null,
          sessionId: `senpi:${sessionId}`,
        })

        deliverContinuation(pi, ctx, content)
      })
    },
  }
}

const START_WORK_CONTINUATION_INJECTION_KEY = "omo-senpi-start-work-continuation"

function deliverContinuation(pi: SenpiExtensionAPI, ctx: ComponentContext, content: string): void {
  if (ctx.idleCoordinator !== undefined) {
    ctx.idleCoordinator.enqueue({
      key: START_WORK_CONTINUATION_INJECTION_KEY,
      source: "boulder-continuation",
      content,
    })
    ctx.idleCoordinator.scheduleFlush()
    return
  }
  pi.sendUserMessage(content, { deliverAs: "followUp" })
}

interface DirectiveState {
  planName: string
  planPath: string
  boulderPath: string
  ledgerPath: string
  checklist: { completed: number; remaining: number; total: number; nextTaskLabel: string | null }
  worktreePath: string | null
  sessionId: string
}

function renderDirective(state: DirectiveState): string {
  const worktreeBlock =
    state.worktreePath === null
      ? ""
      : `\n- Worktree: \`${state.worktreePath}\` (all edits, tests, and commands run inside this directory)`
  const nextLabel = state.checklist.nextTaskLabel ?? "none (final gate pending)"
  const finalGateHint =
    state.checklist.remaining === 0
      ? "\nAll top-level checkboxes are complete. Run the Final Verification Wave and mark the boulder work completed."
      : ""

  return [
    "<omo-senpi-start-work-continuation>",
    "You are mid-flight on a Prometheus work plan; this turn is an automatic continuation. Do NOT ask whether to continue — the contract is auto-continue until every top-level checkbox is `- [x]`.",
    "",
    "# State",
    "",
    `- Plan: \`${state.planName}\``,
    `- Plan file: \`${state.planPath}\``,
    `- Boulder state: \`${state.boulderPath}\``,
    `- Remaining top-level checkboxes: ${state.checklist.remaining} of ${state.checklist.total}`,
    `- [Status: ${state.checklist.completed}/${state.checklist.total}, next: ${nextLabel}]`,
    `- Ledger: \`${state.ledgerPath}\``,
    `- Your session id in boulder.json: ${state.sessionId}`,
    `${worktreeBlock}`,
    "",
    "# What to do this turn",
    "",
    "1. Read the plan file AND the ledger first — they are the only sources of truth for what remains and what evidence exists; do not trust your memory of prior turns.",
    `2. When the remaining count is \`0\`, skip checkbox execution and perform the Final gate now. Otherwise, pick the FIRST unchecked top-level checkbox in \`## TODOs\` or \`## Final Verification Wave\`.${finalGateHint}`,
    "3. Apply the checkbox's tier and verify with real-surface evidence. Decompose and dispatch sub-tasks in parallel via Senpi's `task` tool when safe.",
    "4. After verification, apply the checkbox, append a durable evidence record to the ledger, and continue.",
    "</omo-senpi-start-work-continuation>",
  ].join("\n")
}

function extractCwd(eventCtx: unknown): string | undefined {
  if (isRecord(eventCtx) && typeof eventCtx["cwd"] === "string") {
    return eventCtx["cwd"]
  }
  return undefined
}

function extractSessionId(eventCtx: unknown): string | undefined {
  const sessionManager = extractSessionManager(eventCtx)
  if (sessionManager === undefined) return undefined
  const id = sessionManager.getSessionId()
  return typeof id === "string" ? id : undefined
}

function extractSessionManager(eventCtx: unknown): SessionManagerLike | undefined {
  if (!isRecord(eventCtx)) return undefined
  const value = eventCtx["sessionManager"]
  if (!isRecord(value)) return undefined
  if (typeof value["getSessionId"] !== "function") return undefined
  return value as unknown as SessionManagerLike
}

function isInputEvent(value: unknown): value is InputEventLike {
  return isRecord(value) && typeof value["text"] === "string"
}

function isUserSourcedInput(value: InputEventLike): boolean {
  return value.source !== "extension"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export const __testInternals = {
  renderDirective,
}
