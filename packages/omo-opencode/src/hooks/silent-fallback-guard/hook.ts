import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { PluginContext } from "../../plugin/types"
import { resolveSessionEventID } from "../../shared/event-session-id"
import { createInternalAgentTextPart } from "../../shared/internal-initiator-marker"
import { log } from "../../shared/logger"
import { dispatchInternalPrompt, isInternalPromptDispatchAccepted } from "../shared/prompt-async-gate"
import { resolveSilentFallbackGuardConfig } from "./config"
import { detectJsTsFallbacks } from "./detectors/js-ts"
import { detectPythonFallbacks } from "./detectors/python"
import { normalizeDiffPatch } from "./normalize"
import {
  applyReviewBudget,
  buildReviewerPrompt,
  buildSaturationSummary,
  type GuardReport,
} from "./report"
import type { FallbackCandidate, SilentFallbackGuardConfig } from "./types"

const REPORT_FILE = ".omo/state/hooks/silent-fallback-guard/report.json"
const SUPPORTED_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".py"]
const HOOK_NAME = "silent-fallback-guard"

interface EventInput {
  event: {
    type: string
    properties?: Record<string, unknown>
  }
}

export interface SilentFallbackGuardHookOptions {
  config?: Partial<SilentFallbackGuardConfig>
}

export function createSilentFallbackGuardHook(
  ctx: PluginContext,
  options?: SilentFallbackGuardHookOptions,
) {
  const config = resolveSilentFallbackGuardConfig(options?.config)
  const reviewedHashesBySession = new Map<string, Set<string>>()

  const eventHandler = async ({ event }: EventInput) => {
    if (event.type !== "session.idle") {
      return
    }

    if (!config.enabled) {
      return
    }

    const sessionID = resolveSessionEventID(event.properties)
    if (!sessionID) {
      return
    }

    const cwd = ctx.directory
    let rawDiff = ""
    let failOpenStatus: GuardReport["failOpenStatus"] | undefined

    try {
      const [unstaged, staged] = await Promise.all([
        gitDiff(cwd, false),
        gitDiff(cwd, true),
      ])
      rawDiff = `${unstaged}\n${staged}`.trim()
    } catch (error) {
      failOpenStatus = "DIFF_UNAVAILABLE"
      log(`[${HOOK_NAME}] could not read git diff; failing open.`, {
        sessionID,
        error: String(error),
      })
    }

    const diffHash = createHash("sha256").update(rawDiff || "empty").digest("hex")
    const sessionHashes = reviewedHashesBySession.get(sessionID) ?? new Set<string>()
    if (sessionHashes.has(diffHash)) {
      return
    }

    let candidates: FallbackCandidate[] = []
    if (!failOpenStatus && rawDiff) {
      const lines = normalizeDiffPatch(rawDiff)
      candidates = runDetectors(lines)
    }

    const { selected, skipped, saturation } = applyReviewBudget(candidates, config)

    const report: GuardReport = {
      timestamp: new Date().toISOString(),
      diffHash,
      mode: config.mode,
      candidates,
      selected,
      skipped,
      saturation,
      failOpenStatus,
      pushback: config.mode === "pushback" ? { attempted: false, accepted: false } : undefined,
    }

    try {
      const reportPath = join(cwd, REPORT_FILE)
      await mkdir(dirname(reportPath), { recursive: true })
      await writeFile(reportPath, JSON.stringify(report, null, 2))
    } catch (error) {
      log(`[${HOOK_NAME}] could not write report; continuing.`, {
        sessionID,
        error: String(error),
      })
    }

    sessionHashes.add(diffHash)
    reviewedHashesBySession.set(sessionID, sessionHashes)

    if (config.mode === "pushback" && selected.length > 0) {
      report.pushback = { attempted: true, accepted: false }
      try {
        const reportPath = join(cwd, REPORT_FILE)
        await writeFile(reportPath, JSON.stringify(report, null, 2))
      } catch (error) {
        log(`[${HOOK_NAME}] could not write pushback-attempted report; continuing.`, {
          sessionID,
          error: String(error),
        })
      }

      const pushback = await injectReviewerPrompt(ctx, sessionID, report)
      report.pushback = pushback
      try {
        const reportPath = join(cwd, REPORT_FILE)
        await writeFile(reportPath, JSON.stringify(report, null, 2))
      } catch (error) {
        log(`[${HOOK_NAME}] could not write pushback-result report; continuing.`, {
          sessionID,
          error: String(error),
        })
      }
    } else if (saturation || selected.length > 0) {
      log(`[${HOOK_NAME}] ${buildSaturationSummary(report)}`, { sessionID })
    }
  }

  return {
    event: eventHandler,
  }
}

function runDetectors(lines: import("./normalize").NormalizedLine[]): FallbackCandidate[] {
  const jsTsLines = lines.filter((line) =>
    ["javascript", "typescript"].includes(line.language ?? ""),
  )
  const pythonLines = lines.filter((line) => line.language === "python")
  return [...detectJsTsFallbacks(jsTsLines), ...detectPythonFallbacks(pythonLines)]
}

async function injectReviewerPrompt(
  ctx: PluginContext,
  sessionID: string,
  report: GuardReport,
): Promise<{ attempted: boolean; accepted: boolean; reason?: string }> {
  const promptText = buildReviewerPrompt(report)

  try {
    const promptResult = await dispatchInternalPrompt({
      mode: "async",
      client: ctx.client,
      sessionID,
      source: HOOK_NAME,
      queueBehavior: "defer",
      settleMs: 0,
      dispatchTimeoutMs: 5000,
      input: {
        path: { id: sessionID },
        body: {
          parts: [createInternalAgentTextPart(promptText)],
        },
        query: { directory: ctx.directory },
      },
    })

    if (!isInternalPromptDispatchAccepted(promptResult)) {
      const reason = promptResult.status ?? "unknown"
      log(`[${HOOK_NAME}] reviewer prompt skipped by promptAsync gate`, {
        sessionID,
        status: reason,
      })
      return { attempted: true, accepted: false, reason }
    }

    log(`[${HOOK_NAME}] reviewer prompt injected`, { sessionID })
    return { attempted: true, accepted: true }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    log(`[${HOOK_NAME}] reviewer prompt injection failed; report-only fallback.`, {
      sessionID,
      error: reason,
    })
    return { attempted: true, accepted: false, reason }
  }
}

function gitDiff(cwd: string, cached: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ["diff", "--no-color", "--"]
    if (cached) {
      args.splice(1, 0, "--cached")
    }
    for (const ext of SUPPORTED_EXTENSIONS) {
      args.push(`*${ext}`)
    }
    execFile("git", args, { cwd, encoding: "utf8" }, (error, stdout) => {
      if (error) {
        reject(error)
      } else {
        resolve(stdout)
      }
    })
  })
}
