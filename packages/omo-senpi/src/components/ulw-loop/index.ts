import { findContinuableBoulderWork } from "../start-work-continuation/boulder-eligibility"
import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { resolveOmoBin, runOmoCommand } from "./omo-command"

const STATUS_ARGS = ["ulw-loop", "status", "--json"] as const
const CONTINUATION_LIMIT = 8
const STEERING_REMINDER = [
  "<omo-senpi-ulw-loop>",
  "An active omo ulw-loop run is present in this working directory.",
  "Before continuing, inspect `omo ulw-loop status --json` and use the existing .omo/ulw-loop ledger as the source of truth.",
  "Continue the current ulw-loop story with evidence-bound execution; do not start unrelated work until the active run is complete or checkpointed.",
  "</omo-senpi-ulw-loop>",
].join("\n")
const CONTINUATION_PROMPT = [
  "Continue the active omo ulw-loop run.",
  "Run `omo ulw-loop status --json` in this session cwd, inspect the active incomplete goals, and keep working until the run is complete or safely checkpointed.",
].join("\n")

export interface UlwLoopComponentOptions {
  resolveOmoBin?: () => string | null
  runCommand?: (bin: string, args: readonly string[], options: { cwd: string }) => Promise<{ code: number; stdout: string }>
}

interface InputEventLike {
  text: string
  source?: unknown
  images?: unknown
}

interface ActiveStatus {
  raw: string
  active: boolean
}

type RunCommand = NonNullable<UlwLoopComponentOptions["runCommand"]>

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
      const state = {
        consecutiveContinuations: 0,
        previousStatusRaw: undefined as string | undefined,
      }

      pi.on("input", async (payload, eventCtx) => {
        if (!isInputEvent(payload)) return { action: "continue" }
        if (!isUserSourcedInput(payload)) return { action: "continue" }

        state.consecutiveContinuations = 0
        state.previousStatusRaw = undefined
        const status = await readActiveStatus(omoBin, runCommand, cwdFromContext(eventCtx), ctx)
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

        const status = await readActiveStatus(omoBin, runCommand, cwd, ctx)
        if (status === null) {
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
      content: CONTINUATION_PROMPT,
    })
    ctx.idleCoordinator.scheduleFlush()
    return
  }
  pi.sendUserMessage(CONTINUATION_PROMPT, { deliverAs: "followUp" })
}

async function readActiveStatus(
  omoBin: string,
  runCommand: RunCommand,
  cwd: string,
  ctx: ComponentContext,
): Promise<ActiveStatus | null> {
  let result: { code: number; stdout: string }
  try {
    result = await runCommand(omoBin, STATUS_ARGS, { cwd })
  } catch (error) {
    ctx.logger.warn("omo-senpi ulw-loop status ignored", {
      reason: "run-command-failed",
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
  if (result.code !== 0) {
    ctx.logger.warn("omo-senpi ulw-loop status ignored", { reason: "non-zero-exit", code: result.code })
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

function extractSessionId(eventCtx: unknown): string | undefined {
  if (!isRecord(eventCtx)) return undefined
  const value = eventCtx["sessionManager"]
  if (!isRecord(value) || typeof value["getSessionId"] !== "function") return undefined
  const manager = value as unknown as { getSessionId(): unknown }
  const id = manager.getSessionId()
  return typeof id === "string" ? id : undefined
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
