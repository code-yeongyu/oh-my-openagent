import { join } from "node:path"

import type { ReservedRun } from "@oh-my-opencode/memory-core"

import {
  recordReflectionCompletion,
  type ReflectionCompletionRecord,
  type ReflectionLiveSession,
} from "./completion"
import { readReflectionHealth } from "./health"
import { emitReflectionHealthAlert } from "./health-alert"
import type { ReflectionModelResolution } from "./resolve-model"
import type { ExecutionResult, ReflectionRunResult, SenpiSubprocessRunnerOptions } from "./runner-types"

export async function settleReflectionRun(input: {
  readonly run: ReservedRun
  readonly result: ExecutionResult
  readonly startedAt: string
  readonly resolution: ReflectionModelResolution
  readonly suppressCompletionNotification: boolean
  readonly options: SenpiSubprocessRunnerOptions
  readonly now: () => Date
  readonly ensureRenderer: (live: ReflectionLiveSession | undefined) => void
  readonly warnedHealth: (key: string) => boolean
}): Promise<ReflectionRunResult> {
  const transition = await input.options.reservation.complete(input.run.runId, input.result.outcome)
  const live = input.options.liveSession?.()
  input.ensureRenderer(live)
  const finishedAt = input.now().toISOString()
  const completionsDir = join(input.options.identity.paths.reflection, "completions")
  const healthBefore = await readReflectionHealth(completionsDir)
  const record: ReflectionCompletionRecord = {
    schemaVersion: 1,
    runId: input.run.runId,
    identity: input.options.identity.id,
    category: input.resolution.category,
    ...(input.resolution.kind === "resolved"
      ? {
          model: input.result.model ?? input.resolution.model,
          ...(input.result.model === undefined
            ? input.resolution.thinking === undefined ? {} : { thinking: input.resolution.thinking }
            : input.result.thinking === undefined ? {} : { thinking: input.result.thinking }),
        }
      : {}),
    conversationIds: input.run.request.conversationIds,
    trigger: input.run.request.trigger,
    ...(input.run.request.trigger === "dream" ? { origin: input.run.request.origin } : {}),
    outcome: input.result.outcome,
    ...(input.result.reason === undefined ? {} : { reason: input.result.reason }),
    ...(input.result.detail === undefined ? {} : { detail: input.result.detail }),
    startedAt: input.startedAt,
    finishedAt,
    durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(input.startedAt)),
    consecutiveFailures: input.result.outcome === "failed" ? healthBefore.streak + 1 : 0,
    delivery: { status: "pending" },
  }
  const completion = await recordReflectionCompletion(
    completionsDir,
    record,
    input.suppressCompletionNotification && live
      ? { sessionId: live.sessionId, api: live.api, logger: live.logger }
      : live,
  )
  await emitReflectionHealthAlert(completionsDir, input.options.identity.id, live, input.warnedHealth)
  return {
    runId: input.run.runId,
    outcome: input.result.outcome,
    ...(input.result.reason === undefined ? {} : { reason: input.result.reason }),
    ...(input.result.detail === undefined ? {} : { detail: input.result.detail }),
    completion,
    ...(transition.launch === undefined ? {} : { launch: transition.launch }),
  }
}

export async function publishFinalizedReflectionRun(input: {
  readonly result: ReflectionRunResult
  readonly options: SenpiSubprocessRunnerOptions
  readonly ensureRenderer: (live: ReflectionLiveSession | undefined) => void
  readonly mergedMetadata: (runId: string) => Promise<{ mergedCommitSha?: string; filesChanged?: number }>
  readonly warnedHealth: (key: string) => boolean
}): Promise<ReflectionRunResult> {
  const live = input.options.liveSession?.()
  input.ensureRenderer(live)
  const finishedAt = input.result.completion.finishedAt
  const completionsDir = join(input.options.identity.paths.reflection, "completions")
  const health = await readReflectionHealth(completionsDir)
  const completion = await recordReflectionCompletion(
    completionsDir,
    {
      ...input.result.completion,
      durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(input.result.completion.startedAt)),
      ...(input.result.completion.outcome === "merged"
        ? await input.mergedMetadata(input.result.completion.runId)
        : {}),
      consecutiveFailures: input.result.completion.outcome === "failed" ? health.streak : 0,
    },
    live,
  )
  await emitReflectionHealthAlert(completionsDir, input.options.identity.id, live, input.warnedHealth)
  return { ...input.result, completion }
}
