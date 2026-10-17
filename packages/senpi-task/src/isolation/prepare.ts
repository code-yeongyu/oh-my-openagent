import type { IsolationBackendKind } from "@oh-my-opencode/omo-config-core"

import type { TaskIsolationSpec } from "../state"
import { writeBaseline } from "./baseline-store"
import type { IsolationHandle, IsolationRuntime, WorktreeBaseline } from "./runtime"

export type IsolationPreparation =
  | {
      readonly ok: true
      readonly handle: IsolationHandle
      readonly baseline: WorktreeBaseline
      readonly spec: TaskIsolationSpec
    }
  | { readonly ok: false; readonly reason: string }

export type PrepareIsolationInput = {
  readonly runtime: IsolationRuntime
  readonly cwd: string
  readonly taskId: string
  readonly stateDir: string
  readonly backend: IsolationBackendKind
  readonly mode: "patch" | "branch"
  readonly apply: boolean
  readonly hostPid: number
}

/**
 * Build the child's sandbox BEFORE the record is committed to a launch: a repository that cannot be
 * cloned must refuse the spawn, never silently run the child against the parent checkout, because
 * "isolated" is a safety promise the caller relies on.
 */
export async function prepareIsolation(input: PrepareIsolationInput): Promise<IsolationPreparation> {
  const repoRoot = await input.runtime.resolveRepoRoot(input.cwd)
  if (repoRoot === null) return { ok: false, reason: "not a git checkout" }

  let baseline: WorktreeBaseline
  try {
    baseline = await input.runtime.captureBaseline(repoRoot)
  } catch (error) {
    return { ok: false, reason: `baseline capture failed: ${message(error)}` }
  }

  let handle: IsolationHandle
  try {
    handle = await input.runtime.ensure({
      repoRoot,
      id: input.taskId,
      preferred: input.backend,
      owner: { host: { pid: input.hostPid } },
    })
  } catch (error) {
    return { ok: false, reason: message(error) }
  }

  try {
    writeBaseline(input.stateDir, input.taskId, baseline)
  } catch (error) {
    await input.runtime.cleanup(handle).catch(() => undefined)
    return { ok: false, reason: `baseline could not be persisted: ${message(error)}` }
  }

  return {
    ok: true,
    handle,
    baseline,
    spec: {
      backend: handle.backend,
      fell_back: handle.fellBack,
      merged_dir: handle.mergedDir,
      base_dir: handle.baseDir,
      mode: input.mode,
      apply: input.apply,
    },
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
