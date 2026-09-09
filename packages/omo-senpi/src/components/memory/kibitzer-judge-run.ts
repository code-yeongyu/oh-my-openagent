import { mkdir, writeFile } from "@oh-my-opencode/memory-core/fs"
import type { RecallNudge } from "@oh-my-opencode/memory-core"
import type { ChildHandle } from "@oh-my-opencode/senpi-task"
import { join } from "node:path"

import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import { abortAndDispose } from "./kibitzer-lifecycle"
import { childModelChainSpec } from "./memory-child-model-chain"
import { classifyJudgeTurn, normalizeGateReason } from "./kibitzer-judge-outcome"
import { buildKibitzerJudgeSpec } from "./kibitzer-judge-spec"
import { kibitzerCandidatesPayload, renderTranscriptWindow } from "./kibitzer-prompt"
import { writeKibitzerRunOutcome } from "./kibitzer-run-retention"
import type {
  KibitzerGateLaunchInput,
  KibitzerGateLaunchResult,
  KibitzerGateLaunchState,
  KibitzerGateRunnerOptions,
} from "./kibitzer-runner"
import type { ReflectionModelResolution } from "./worker/resolve-model"

export type KibitzerJudgeRunHost = {
  readonly options: KibitzerGateRunnerOptions
  readonly deadlineMs: number
  handle: ChildHandle | undefined
  state: KibitzerGateLaunchState | undefined
}

/**
 * Run the judge as an in-process child session and await its single turn. The absolute deadline
 * replaces SIGTERM/SIGKILL escalation: an abort timer fires handle.abort() and the race resolves
 * the launch immediately, never waiting for a turn that will not settle.
 */
export async function runKibitzerJudge(
  host: KibitzerJudgeRunHost,
  input: KibitzerGateLaunchInput,
  resolution: Extract<ReflectionModelResolution, { readonly kind: "resolved" }>,
  runId: string,
  accepted: RecallNudge[],
  state: KibitzerGateLaunchState,
): Promise<{ readonly status: "completed"; readonly partial?: true; readonly model?: string } | Extract<KibitzerGateLaunchResult, { readonly status: "failed" | "dropped" }>> {
  const runDir = join(host.options.identityPaths.recall, "runs", runId)
  const record = async <T extends { readonly status: "completed" | "failed" | "dropped"; readonly cause?: string; readonly model?: string }>(
    result: T,
  ): Promise<T> => {
    await writeKibitzerRunOutcome({
      runDir,
      runId,
      status: result.status,
      model: result.model ?? resolution.model,
      ...(result.cause === undefined ? {} : { cause: result.cause }),
      nudged: accepted.map((nudge) => nudge.path),
      now: () => new Date(),
      warn: (message, fields) => host.options.logger?.warn(message, fields),
    })
    return result
  }
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined
  let deadlineReached = false
  const deadline = new Promise<"deadline">((resolve) => {
    deadlineTimer = setTimeout(() => {
      deadlineReached = true
      resolve("deadline")
    }, Math.max(0, host.deadlineMs))
    deadlineTimer.unref?.()
  })
  const setup = (async (): Promise<ChildHandle> => {
    await mkdir(runDir, { recursive: true, mode: 0o700 })
    // Auditable artifacts, NOT inputs: the child receives both inline in its prompt and holds no
    // read tool. The run dir is kept after the run so a live or finished judge can be inspected.
    await Promise.all([
      writeFile(join(runDir, "candidates.json"), `${JSON.stringify(kibitzerCandidatesPayload(input), null, 2)}\n`, { encoding: "utf8", mode: 0o600 }),
      writeFile(join(runDir, "transcript-window.txt"), renderTranscriptWindow(input.transcript), { encoding: "utf8", mode: 0o600 }),
    ])

    const taskRuntime = await import("#omo-task-runtime")
    const runnerOptions = host.options.createSession === undefined ? {} : { createSession: host.options.createSession }
    const runner = host.options.createRunner?.(runnerOptions)
      ?? taskRuntime.createInProcessJudgeRunner(runnerOptions)
    return runner.start(buildKibitzerJudgeSpec({
      launch: input,
      runId,
      runDir,
      agentDir: resolveAgentHome({ env: host.options.env }),
      model: input.modelRegistry === undefined ? undefined : taskRuntime.findModelReference(input.modelRegistry, resolution.model),
      chain: childModelChainSpec({ model: resolution.model, fallbacks: resolution.fallbacks }),
      ...(resolution.thinking === undefined ? {} : { thinkingLevel: resolution.thinking }),
      accepted,
    }))
  })()
  const setupResult = setup.then(
    async (handle) => {
      if (deadlineReached || state.cancelled) {
        await abortAndDispose(handle, host.options.logger, runId)
        return undefined
      }
      host.handle = handle
      host.state = state
      return handle
    },
    (error: unknown) => {
      if (deadlineReached || state.cancelled) return undefined
      throw error
    },
  )
  try {
    const settled = await Promise.race([setupResult, deadline])
    if (settled === "deadline" || settled === undefined) {
      const handle = host.handle
      if (handle !== undefined) await abortAndDispose(handle, host.options.logger, runId)
      if (state.cancelled && settled === undefined) {
        return await record({ status: "dropped", cause: "cancelled", runId, candidateCount: input.candidates.length })
      }
      host.options.logger?.warn("kibitzer gate deadline exceeded", { runId, salvaged: accepted.length })
      if (accepted.length > 0) return await record({ status: "completed", partial: true })
      state.cancelled = true
      return await record({ status: "dropped", cause: "deadline", model: resolution.model, candidateCount: input.candidates.length, runId })
    }
    const raced = await Promise.race([
      settled.waitForIdle().then((outcome) => ({ kind: "turn-settled" as const, outcome })),
      deadline,
    ])
    if (raced === "deadline") {
      host.options.logger?.warn("kibitzer gate deadline exceeded", { runId, salvaged: accepted.length })
      await abortAndDispose(settled, host.options.logger, runId)
      if (accepted.length > 0) return await record({ status: "completed", partial: true })
      state.cancelled = true
      return await record({ status: "dropped", cause: "deadline", model: resolution.model, candidateCount: input.candidates.length, runId })
    }
    const classification = classifyJudgeTurn(raced.outcome)
    const model = raced.outcome.status === "cancelled" ? undefined : raced.outcome.model
    if (classification.status === "failed") {
      const reason = normalizeGateReason(classification.reason)
      host.options.logger?.warn("kibitzer gate child failed", { runId, cause: classification.cause, reason })
      return await record({ status: "failed", cause: classification.cause, reason, runId, model: model ?? resolution.model, candidateCount: input.candidates.length })
    }
    if (classification.status === "dropped") {
      return await record({ status: "dropped", cause: "cancelled", runId, candidateCount: input.candidates.length })
    }
    return await record({ status: "completed", ...(model === undefined ? {} : { model }) })
  } catch (error) {
    host.options.logger?.warn("kibitzer gate child session creation failed", { error: normalizeGateReason(describe(error)), runId })
    return await record({ status: "failed", cause: "session_create_failed", reason: normalizeGateReason(describe(error)), runId, model: resolution.model, candidateCount: input.candidates.length })
  } finally {
    const handle = (clearTimeout(deadlineTimer), host.handle)
    if (handle !== undefined) {
      host.handle = undefined
      handle.dispose()
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
