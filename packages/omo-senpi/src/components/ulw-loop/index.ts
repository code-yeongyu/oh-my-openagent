import { existsSync } from "node:fs"

import { findContinuableBoulderWork } from "../ulw-execute-continuation/boulder-eligibility"
import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { createUlwLoopFooterStatus, type UlwLoopFooterStatusOptions } from "./footer-status"
import { resolveOmoBin, runOmoCommand } from "./omo-command"
import { extractSessionId, resolveUlwLoopSessionScope, ulwLoopScopedGoalsPath, ulwLoopStatusArgs } from "./session-scope"

const CONTINUATION_LIMIT = 8
const STEERING_REMINDER = [
  "<omo-senpi-ulw-loop>",
  "An active omo-agent-toolkit ulw-loop run is present in this working directory.",
  "Before continuing, inspect `omo-agent-toolkit ulw-loop status --json` and use the existing .omo/ulw-loop ledger as the source of truth.",
  "Continue the current ulw-loop story with evidence-bound execution; do not start unrelated work until the active run is complete or checkpointed.",
  "</omo-senpi-ulw-loop>",
].join("\n")
const CONTINUATION_PROMPT = [
  "Continue the active omo-agent-toolkit ulw-loop run.",
  "Run `omo-agent-toolkit ulw-loop status --json` in this session cwd, inspect the active incomplete goals, and keep working until the run is complete or safely checkpointed.",
].join("\n")

export interface UlwLoopComponentOptions {
  resolveOmoBin?: () => string | null
  runCommand?: (bin: string, args: readonly string[], options: { cwd: string }) => Promise<{ code: number; stdout: string }>
  planExists?: (cwd: string, sessionId: string) => boolean
  footerStatus?: UlwLoopFooterStatusOptions
}

interface InputEventLike {
  text: string
  source?: unknown
  images?: unknown
  streamingBehavior?: unknown
}

interface ActiveStatus {
  raw: string
  active: boolean
  // false marks a probe that never ran because this host could not prove which run it owns.
  sessionScoped?: boolean
}

type RunCommand = NonNullable<UlwLoopComponentOptions["runCommand"]>
type PlanLookup = NonNullable<UlwLoopComponentOptions["planExists"]>

export function createUlwLoopComponent(options: UlwLoopComponentOptions = {}): OmoSenpiComponent {
  return {
    name: "ulw-loop",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      const omoBin = (options.resolveOmoBin ?? resolveOmoBin)()
      if (omoBin === null) {
        ctx.logger.info("omo-senpi ulw-loop inactive; omo binary not found")
        pi.on("input", () => ({ action: "continue" }))
        pi.on("agent_end", () => undefined)
        return
      }

      const runCommand = options.runCommand ?? runOmoCommand
      const planExists = options.planExists ?? ulwLoopPlanExists
      const footerStatus = createUlwLoopFooterStatus(options.footerStatus)
      const state = {
        consecutiveContinuations: 0,
        previousStatusRaw: undefined as string | undefined,
      }

      pi.on("session_start", async (_payload, eventCtx) => {
        const status = await readActiveStatus(omoBin, runCommand, planExists, eventCtx, ctx)
        footerStatus.sync(eventCtx, status?.active ?? false)
      })

      pi.on("input", async (payload, eventCtx) => {
        if (!isInputEvent(payload)) return { action: "continue" }
        if (!isUserSourcedInput(payload)) return { action: "continue" }

        state.consecutiveContinuations = 0
        state.previousStatusRaw = undefined
        if (payload.streamingBehavior === undefined) return { action: "continue" }
        const status = await readActiveStatus(omoBin, runCommand, planExists, eventCtx, ctx)
        footerStatus.sync(eventCtx, status?.active ?? false)
        if (status === null || !status.active) return { action: "continue" }
        return {
          action: "transform",
          text: `${payload.text}\n\n${STEERING_REMINDER}`,
          ...(Array.isArray(payload.images) ? { images: payload.images } : {}),
        }
      })

      pi.on("agent_end", async (_payload, eventCtx) => {
        if (state.consecutiveContinuations >= CONTINUATION_LIMIT) {
          ctx.logger.info("omo-senpi ulw-loop continuation skipped", {
            reason: "continuation-cap-reached",
            count: state.consecutiveContinuations,
          })
          return
        }

        const cwd = cwdFromContext(eventCtx)
        const sessionId = extractSessionId(eventCtx)
        if (sessionId && findContinuableBoulderWork(cwd, sessionId) !== null) {
          ctx.logger.info("omo-senpi ulw-loop continuation skipped", { reason: "boulder-continuation-active" })
          return
        }

        const status = await readActiveStatus(omoBin, runCommand, planExists, eventCtx, ctx)
        footerStatus.sync(eventCtx, status?.active ?? false)
        if (status === null) {
          return
        }
        if (status.sessionScoped === false) {
          ctx.logger.info("omo-senpi ulw-loop continuation skipped", { reason: "session-id-unavailable" })
          return
        }
        if (!status.active) {
          state.previousStatusRaw = undefined
          ctx.logger.info("omo-senpi ulw-loop continuation skipped", { reason: "inactive" })
          return
        }
        if (state.previousStatusRaw === status.raw) {
          ctx.logger.info("omo-senpi ulw-loop continuation skipped", { reason: "stale-status" })
          return
        }

        state.previousStatusRaw = status.raw
        state.consecutiveContinuations += 1
        deliverContinuation(pi, ctx)
      })

      pi.on("tool_result", async (payload, eventCtx) => {
        if (!shouldRefreshFooterAfterToolResult(payload)) return
        const status = await readActiveStatus(omoBin, runCommand, planExists, eventCtx, ctx)
        footerStatus.sync(eventCtx, status?.active ?? false)
      })

      pi.on("session_before_switch", () => footerStatus.dispose())
      pi.on("session_shutdown", () => footerStatus.dispose())
    },
  }
}

const ULW_CONTINUATION_INJECTION_KEY = "omo-senpi-ulw-loop-continuation"

// Route the continuation through the idle-injection coordinator when the composition provides one, so
// a task completion and this continuation on the same idle edge collapse to a single wake. The
// continuation only enqueues then requests a DEFERRED flush: a synchronous completion wake on the same
// idle edge drains the shared queue first and carries the continuation with it, so the deferred pass
// no-ops. Falls back to a direct followUp when no coordinator is wired (isolated unit context).
function deliverContinuation(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
  if (ctx.idleCoordinator !== undefined) {
    ctx.idleCoordinator.enqueue({
      key: ULW_CONTINUATION_INJECTION_KEY,
      source: "ulw-continuation",
      customType: "omo-senpi:ulw-continuation",
      content: CONTINUATION_PROMPT,
      display: false,
    })
    ctx.idleCoordinator.scheduleFlush()
    return
  }
  pi.sendMessage(
    {
      customType: "omo-senpi:ulw-continuation",
      content: CONTINUATION_PROMPT,
      display: false,
    },
    { triggerTurn: true, deliverAs: "followUp" },
  )
}

function ulwLoopPlanExists(cwd: string, sessionId: string): boolean {
  return existsSync(ulwLoopScopedGoalsPath(cwd, sessionId))
}

async function readActiveStatus(
  omoBin: string,
  runCommand: RunCommand,
  planExists: PlanLookup,
  eventCtx: unknown,
  ctx: ComponentContext,
): Promise<ActiveStatus | null> {
  const cwd = cwdFromContext(eventCtx)
  // Fail closed: without a session identity the toolkit would answer from the unscoped repo-global
  // `.omo/ulw-loop/goals.json`, which every session sharing this cwd can see. Never auto-continue a run
  // this host cannot prove it owns.
  const sessionId = resolveUlwLoopSessionScope(eventCtx)
  if (sessionId === null) return { raw: "", active: false, sessionScoped: false }

  // Spawning the toolkit costs two node startups (`bin/omo-agent-toolkit.js` re-spawns `cli.js`), and the
  // input hook is awaited inside `emitInput` before the submitted message is committed. Without this
  // session's goals.json the toolkit can only answer ULW_LOOP_PLAN_MISSING, so answer inactive without
  // paying for it.
  if (!planExists(cwd, sessionId)) return { raw: "", active: false }

  let result: { code: number; stdout: string }
  try {
    result = await runCommand(omoBin, ulwLoopStatusArgs(sessionId), { cwd })
  } catch (error) {
    ctx.logger.warn("omo-senpi ulw-loop status ignored", {
      reason: "run-command-failed",
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
  if (result.code !== 0) {
    const errorCode = toolkitErrorCode(result.stdout)
    const details = { reason: "non-zero-exit" as const, code: result.code, errorCode }
    if (errorCode === "ULW_LOOP_PLAN_MISSING") {
      ctx.logger.debug?.("omo-senpi ulw-loop status ignored", details)
      return { raw: result.stdout, active: false }
    }
    ctx.logger.warn("omo-senpi ulw-loop status ignored", details)
    return { raw: result.stdout, active: false }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(result.stdout)
  } catch {
    ctx.logger.warn("omo-senpi ulw-loop status ignored", { reason: "malformed-json" })
    return { raw: result.stdout, active: false }
  }

  return { raw: result.stdout, active: statusHasActiveIncompleteRun(parsed) }
}

function toolkitErrorCode(stdout: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(stdout)
    if (!isRecord(parsed) || !isRecord(parsed["error"])) return undefined
    const code = parsed["error"]["code"]
    return typeof code === "string" ? code : undefined
  } catch {
    return undefined
  }
}


function statusHasActiveIncompleteRun(value: unknown): boolean {
  if (!isRecord(value) || value["ok"] !== true || !isRecord(value["plan"])) return false
  const plan = value["plan"]
  if (isRecord(plan["aggregateCompletion"]) && plan["aggregateCompletion"]["status"] === "complete") return false
  const goals = plan["goals"]
  if (!Array.isArray(goals)) return false
  return goals.some(isIncompleteGoal)
}

function isIncompleteGoal(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (value["steeringStatus"] === "superseded" || value["steeringStatus"] === "blocked") return false
  if (value["status"] !== "pending" && value["status"] !== "in_progress") return false
  const criteria = value["successCriteria"]
  if (!Array.isArray(criteria) || criteria.length === 0) return true
  return criteria.some((criterion) => !isRecord(criterion) || criterion["status"] !== "pass")
}

function isInputEvent(value: unknown): value is InputEventLike {
  return isRecord(value) && typeof value["text"] === "string"
}

function isUserSourcedInput(value: InputEventLike): boolean {
  return value.source !== "extension"
}

function shouldRefreshFooterAfterToolResult(value: unknown): boolean {
  if (!isRecord(value)) return false
  const toolName = value["toolName"]
  return toolName === "create_goal"
    || toolName === "update_goal"
    || toolName === "bash"
    || toolName === "interactive_bash"
}

function cwdFromContext(value: unknown): string {
  if (isRecord(value) && typeof value["cwd"] === "string") return value["cwd"]
  return process.cwd()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export const __testInternals = {
  resolveOmoBin,
  runOmoCommand,
}
