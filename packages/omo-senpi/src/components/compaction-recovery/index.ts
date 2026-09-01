import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import {
  asRejectedRequiredCompaction,
  extractRecoveryEventContext,
  type RecoveryApplyResult,
  type RecoveryUsage,
  type RejectedRequiredCompaction,
} from "./detection"
import {
  writeCompactionRecoveryDiagnostics,
  type AppendDiagnostics,
  type CompactionRecoveryRecord,
} from "./diagnostics"
import { planRescueCompaction } from "./rescue"

export const COMPACTION_RECOVERY_GUIDANCE_TYPE = "omo-compaction-recovery:guidance"

const GUIDANCE_TEXT = [
  "Context compaction failed and this session is still over its context budget, so it can no longer grow safely.",
  "Recovery options: start a new session and continue there (the old transcript stays readable), or retry a manual compaction once the summarization provider is responsive again.",
  "Re-launch any background tasks or delegated work in the new session so they inherit fresh context.",
].join("\n")

export interface CompactionRecoveryComponentOptions {
  /** Injectable deferral so tests run synchronously; production unwinds the failed pipeline first. */
  schedule?: (fn: () => void) => void
  /** Injectable agent-dir resolution for tests. */
  resolveAgentHomeDir?: () => string | undefined
  /** Injectable JSONL appender for tests. */
  appendDiagnostics?: AppendDiagnostics
}

interface RecoveryPorts {
  getContextUsage?: () => RecoveryUsage | undefined
  getCompactionSettings?: () => { reserveTokens?: number } | undefined
  isCompacting?: () => boolean
  applyCompaction?: (precomputed: unknown, options: { reason: "threshold" | "overflow" }) => Promise<RecoveryApplyResult> | RecoveryApplyResult
  sessionManager?: { getBranch?: () => readonly unknown[] }
}

function defaultSchedule(fn: () => void): void {
  setTimeout(fn, 0)
}

function defaultResolveAgentHomeDir(): string | undefined {
  try {
    return resolveAgentHome({ env: process.env })
  } catch {
    return undefined
  }
}

function retentionBudget(usage: RecoveryUsage, reserveTokens: number | undefined): number | undefined {
  if (usage.contextWindow <= 0) return undefined
  return usage.contextWindow - (reserveTokens ?? 16384)
}

/**
 * #6871 compaction deadlock recovery.
 *
 * When a REQUIRED compaction (threshold/overflow) is rejected because the engine's
 * summarization route gave up (`cancelled-by-extension`), the session stays above
 * its retention budget and every retry fails the same way. This component:
 * 1. persists a structured diagnosis for every rejection (the engine only shows the
 *    cause in the TUI),
 * 2. applies a deterministic shrinking-suffix rescue through the sanctioned
 *    applyCompaction API once the failed pipeline has unwound,
 * 3. emits one visible guidance message when no rescue could be applied, instead of
 *    leaving the session silently stuck.
 */
export function createCompactionRecoveryComponent(
  options: CompactionRecoveryComponentOptions = {},
): OmoSenpiComponent {
  const schedule = options.schedule ?? defaultSchedule
  const resolveAgentHomeDir = options.resolveAgentHomeDir ?? defaultResolveAgentHomeDir

  return {
    name: "compaction-recovery",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      let guidanceEmitted = false
      // Component-owned: two rejections can be deferred before the first rescue resolves, and both
      // would otherwise call applyCompaction against the same branch. isCompacting() only covers
      // compactions the host already owns, not one this component is about to start.
      let rescueInFlight = false

      const emitGuidanceOnce = (): void => {
        if (guidanceEmitted) return
        guidanceEmitted = true
        pi.sendMessage({
          customType: COMPACTION_RECOVERY_GUIDANCE_TYPE,
          content: GUIDANCE_TEXT,
          display: true,
        })
      }

      const writeRecord = (record: CompactionRecoveryRecord): void => {
        ctx.logger.info("omo-senpi compaction-recovery diagnosis", record)
        writeCompactionRecoveryDiagnostics({
          agentHome: resolveAgentHomeDir(),
          record,
          append: options.appendDiagnostics,
        })
      }

      pi.on("session_compact", (payload: unknown, eventCtx: unknown): void => {
        const rejected = asRejectedRequiredCompaction(payload)
        if (!rejected) return

        const ports: RecoveryPorts = extractRecoveryEventContext(eventCtx) ?? {}
        const usage = ports.getContextUsage?.()
        const settings = ports.getCompactionSettings?.()
        writeRecord({
          phase: "rejected",
          reason: rejected.reason,
          rejectionCause: rejected.rejectionCause,
          tokens: usage?.tokens ?? null,
          contextWindow: usage?.contextWindow ?? null,
          reserveTokens: settings?.reserveTokens ?? null,
          branchEntries: ports.sessionManager?.getBranch?.().length ?? null,
        })

        // Defer past the failing compaction pipeline so applyCompaction never runs
        // nested inside the rejection stack it is recovering from.
        schedule(() => {
          if (rescueInFlight) return
          rescueInFlight = true
          // runRescue is async, so a rejection from applyCompaction escapes a surrounding try.
          // It has to be caught on the promise, and the user still needs the guidance message.
          void runRescue(rejected)
            .catch((error: unknown) => {
              ctx.logger.error("omo-senpi compaction-recovery rescue failed", { error })
              emitGuidanceOnce()
            })
            .finally(() => {
              rescueInFlight = false
            })
        })

        async function runRescue(rejection: RejectedRequiredCompaction): Promise<void> {
          const currentUsage = ports.getContextUsage?.()
          if (!currentUsage) return
          const budget = retentionBudget(currentUsage, ports.getCompactionSettings?.()?.reserveTokens)
          if (budget === undefined) return
          // Another compaction owns the session, or the context already recovered:
          // nothing to rescue.
          if (ports.isCompacting?.() === true) return
          if (currentUsage.tokens === null || currentUsage.tokens <= budget) return

          const entries = ports.sessionManager?.getBranch?.() ?? []
          const plan = planRescueCompaction({
            entries,
            usage: currentUsage,
            reserveTokens: ports.getCompactionSettings?.()?.reserveTokens ?? 16384,
          })
          if (!plan) {
            writeRecord({
              phase: "rescue-unavailable",
              reason: rejection.reason,
              rejectionCause: rejection.rejectionCause,
              tokens: currentUsage.tokens,
              contextWindow: currentUsage.contextWindow,
              reserveTokens: ports.getCompactionSettings?.()?.reserveTokens ?? null,
              branchEntries: entries.length,
              detail: "no safe boundary fits the retention budget",
            })
            emitGuidanceOnce()
            return
          }

          const result = await ports.applyCompaction?.(plan, { reason: rejection.reason })
          if (result?.applied) {
            writeRecord({
              phase: "rescue-applied",
              reason: rejection.reason,
              rejectionCause: rejection.rejectionCause,
              tokens: currentUsage.tokens,
              contextWindow: currentUsage.contextWindow,
              reserveTokens: ports.getCompactionSettings?.()?.reserveTokens ?? null,
              branchEntries: entries.length,
              detail: `firstKeptEntryId=${plan.firstKeptEntryId}`,
            })
            return
          }
          writeRecord({
            phase: "rescue-refused",
            reason: rejection.reason,
            rejectionCause: rejection.rejectionCause,
            tokens: currentUsage.tokens,
            contextWindow: currentUsage.contextWindow,
            reserveTokens: ports.getCompactionSettings?.()?.reserveTokens ?? null,
            branchEntries: entries.length,
            detail: result?.reason,
          })
          emitGuidanceOnce()
        }
      })
    },
  }
}
