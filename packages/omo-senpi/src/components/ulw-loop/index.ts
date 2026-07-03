import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"

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
        if (!status.active) return { action: "continue" }
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

        const status = await readActiveStatus(omoBin, runCommand, cwdFromContext(eventCtx), ctx)
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
        pi.sendUserMessage(CONTINUATION_PROMPT, { deliverAs: "followUp" })
      })
    },
  }
}

function resolveOmoBin(): string | null {
  const envBin = process.env.OMO_BIN?.trim()
  if (envBin) return envBin
  const result = Bun.spawnSync(["which", "omo"], { stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) return null
  const resolved = result.stdout.toString("utf8").trim()
  return resolved.length > 0 ? resolved : null
}

async function runOmoCommand(
  bin: string,
  args: readonly string[],
  options: { cwd: string },
): Promise<{ code: number; stdout: string }> {
  const process = Bun.spawn([bin, ...args], {
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, code] = await Promise.all([new Response(process.stdout).text(), process.exited])
  return { code, stdout }
}

async function readActiveStatus(
  omoBin: string,
  runCommand: RunCommand,
  cwd: string,
  ctx: ComponentContext,
): Promise<ActiveStatus> {
  const result = await runCommand(omoBin, STATUS_ARGS, { cwd })
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

function cwdFromContext(value: unknown): string {
  if (isRecord(value) && typeof value["cwd"] === "string") return value["cwd"]
  return process.cwd()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
