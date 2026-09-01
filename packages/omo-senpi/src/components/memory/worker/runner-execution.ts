import { existsSync } from "@oh-my-opencode/memory-core/fs"
import { join } from "node:path"

import {
  GitMemoryRepo,
  buildDefaultSeedFiles,
  cleanupReflectionWorktree,
  installHooks,
  type ReflectionFinalizeResult,
  type ReflectionWorktree,
  type ReservedRun,
} from "@oh-my-opencode/memory-core"

import type { SenpiOmoConfigResult } from "../../config-resolution"
import { resolveAgentReflectionSettings } from "../reflection-settings"
import { createRunWorktree } from "./create-run-worktree"
import { resolveAndPreflightMemoryLaunch } from "./memory-launch-preflight"
import {
  MemoryModelExhaustedError,
  type MemoryModelChain,
} from "./memory-model-attempts"
import type { MemoryLaunchRoute } from "./fork-cost"
import { prepareReflectionCandidateSpawn } from "./reflection-spawn-input"
import type { ReflectionModelResolution } from "./resolve-model"
import { readRunJson } from "./run-artifacts"
import { failReservationRun, finalizeRecordedOutcome, overrideFailedReservationRun } from "./run-finalization"
import type { RunFinalizationContext } from "./run-finalization-types"
import { parseReservationRunLedger } from "./reservation-run-ledger"
import { requireFinalizedResult } from "./runner-finalization-result"
import { cleanupSucceeded, errorMessage } from "./runner-results"
import type { ExecutionResult, ReflectionRunResult, SenpiSubprocessRunnerOptions } from "./runner-types"
import { runReflectionChild } from "./spawn"

export async function executeReflectionRun(input: {
  readonly run: ReservedRun
  readonly resolution: Extract<ReflectionModelResolution, { readonly kind: "resolved" }>
  readonly route?: MemoryLaunchRoute
  readonly loaded: SenpiOmoConfigResult
  readonly startedAt: string
  readonly options: SenpiSubprocessRunnerOptions
  readonly now: () => number
  readonly finalizationContext: () => RunFinalizationContext
  readonly appendLaunched: () => Promise<void>
}): Promise<ExecutionResult | ReflectionRunResult> {
  const { run, resolution, loaded, options } = input
  const repo = new GitMemoryRepo({ dir: options.identity.paths.repo, agentId: options.identity.id })
  if (!existsSync(join(options.identity.paths.repo, ".git"))) {
    await repo.init({ seedFiles: buildDefaultSeedFiles(), installHooks: (dir) => { installHooks(dir) } })
  }
  let worktree: ReflectionWorktree | undefined
  try {
    worktree = await createRunWorktree(repo, run.runId, options.identity.paths)
    const activeWorktree = worktree
    const reflection = resolveAgentReflectionSettings(loaded.config.memory, options.identity.id)
    const hardDeadlineAt = input.now() + (options.deadlineMs ?? reflection.timeout_minutes * 60_000)
    const candidates: MemoryModelChain = [
      {
        model: resolution.model,
        ...(resolution.thinking === undefined ? {} : { thinking: resolution.thinking }),
      },
      ...resolution.fallbacks,
    ]
    const env = options.env ?? process.env
    let launched = false
    await (options.resolveAndPreflightLaunch ?? resolveAndPreflightMemoryLaunch)({
      candidates,
      senpiCommand: options.senpiCommand,
      senpiPrefixArgs: options.senpiPrefixArgs,
      env,
      envFlag: "SENPI_MEMORY_REFLECTION",
      configSources: loaded.sources,
      warn: (message, details) => options.logger?.warn(message, details),
      surfaceName: "reflection",
      attempt: async (candidate, attemptNumber, nextAttempt) => {
        const parentSessionFile = input.route?.route === "fork" ? options.resolveParentSessionFile?.() : undefined
        const parentCwd = input.route?.route === "fork" ? options.cwd : undefined
        const spawnArgs = await prepareReflectionCandidateSpawn({
          ...(parentSessionFile === undefined
            ? {}
            : { fork: { parentSessionFile, ...(parentCwd === undefined ? {} : { parentCwd }) } }),
          run,
          worktree: activeWorktree,
          mergePolicy: reflection.merge,
          category: reflection.category,
          candidate,
          attempt: attemptNumber,
          hardDeadlineAt,
          nextAttempt,
          config: loaded.config,
          identity: options.identity,
          env,
          senpiCommand: options.senpiCommand,
          senpiPrefixArgs: options.senpiPrefixArgs,
        })
        if (!launched) {
          await input.appendLaunched()
          launched = true
        }
        return runReflectionChild(spawnArgs, {
          terminationGraceMs: options.terminationGraceMs,
          maxOutputBytes: options.maxOutputBytes,
          sandbox: options.sandbox,
          supervisorPath: options.supervisorPath,
        })
      },
    })
  } catch (error) {
    return finalizeExecutionFailure(input, worktree, error)
  }
  const runDir = join(options.identity.paths.reflection, "runs", run.runId)
  const ledger = parseReservationRunLedger(await readRunJson<unknown>(join(runDir, "ledger.json")))
  const finalized = await finalizeRecordedOutcome(input.finalizationContext(), runDir, ledger)
  return requireFinalizedResult(finalized)
}

async function finalizeExecutionFailure(
  input: Parameters<typeof executeReflectionRun>[0],
  worktree: ReflectionWorktree | undefined,
  error: unknown,
): Promise<ExecutionResult | ReflectionRunResult> {
  const runDir = join(input.options.identity.paths.reflection, "runs", input.run.runId)
  if (existsSync(join(runDir, "ledger.json"))) {
    const ledger = parseReservationRunLedger(await readRunJson<unknown>(join(runDir, "ledger.json")))
    const finalized = error instanceof MemoryModelExhaustedError
      ? await overrideFailedReservationRun(input.finalizationContext(), runDir, ledger, error.message)
      : await failReservationRun(input.finalizationContext(), runDir, ledger, "failed", errorMessage(error))
    return requireFinalizedResult(finalized)
  }
  const discarded = worktree === undefined ? undefined : await discardWorktree(worktree)
  return {
    outcome: "failed",
    reason: discarded !== undefined && !cleanupSucceeded(discarded) ? "cleanup_failed" : "spawn_failed",
    detail: [errorMessage(error), discarded?.detail].filter(Boolean).join("; "),
  }
}

async function discardWorktree(worktree: ReflectionWorktree): Promise<ReflectionFinalizeResult> {
  const cleanup = await cleanupReflectionWorktree(worktree)
  return { status: "failed", cleanup }
}
