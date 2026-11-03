import type { IsolationMergeResult, TaskIsolationSpec } from "../state"
import { readBaseline } from "./baseline-store"
import type { CoreMergeResult, IsolationHandle, IsolationRuntime, WorktreeBaseline } from "./runtime"

const RETAINING_KINDS = new Set(["not-applied", "branch-merge-failed"])

export type SettleIsolationInput = {
  readonly runtime: IsolationRuntime
  readonly stateDir: string
  readonly taskId: string
  readonly isolation: TaskIsolationSpec
  /** Only a `completed` child earns a merge; every other terminal keeps artifacts and touches nothing. */
  readonly merge: boolean
  readonly reason?: string
  readonly baseline?: WorktreeBaseline
  readonly handle?: IsolationHandle
}

export async function settleIsolation(input: SettleIsolationInput): Promise<IsolationMergeResult> {
  const started = Date.now()
  const baseline = input.baseline ?? readBaseline(input.stateDir, input.taskId)
  if (baseline === null) {
    return {
      kind: "retained",
      changesApplied: false,
      duration_ms: Date.now() - started,
      error: "isolation baseline is unavailable; the clone is left for manual inspection",
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    }
  }

  let core: CoreMergeResult
  try {
    const delta = await input.runtime.captureDelta(input.isolation.merged_dir, baseline)
    core = await input.runtime.merge({
      mode: input.isolation.mode,
      apply: input.merge && input.isolation.apply,
      repoRoot: baseline.root.repoRoot,
      isolationDir: input.isolation.merged_dir,
      baseline,
      delta,
      id: input.taskId,
      artifactsDir: input.stateDir,
    })
  } catch (error) {
    return {
      kind: "retained",
      changesApplied: false,
      duration_ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    }
  }

  const result = project(core, Date.now() - started, input.reason)
  await disposeWorkspace(input, result)
  return result
}

function project(core: CoreMergeResult, durationMs: number, reason: string | undefined): IsolationMergeResult {
  return {
    kind: core.kind,
    changesApplied: core.changes_applied,
    duration_ms: durationMs,
    summaryPath: core.summary_path,
    filesChanged: core.files_changed,
    ...(core.patch_path === undefined ? {} : { patchPath: core.patch_path }),
    ...(core.nested_patch_paths === undefined ? {} : { nestedPatchPaths: core.nested_patch_paths }),
    ...(core.branch_name === undefined ? {} : { branchName: core.branch_name }),
    ...(core.partial === undefined ? {} : { partial: core.partial }),
    ...(core.conflict === undefined ? {} : { conflict: core.conflict }),
    ...(core.manual_command === undefined ? {} : { manualCommand: core.manual_command }),
    ...(core.warning === undefined ? {} : { error: core.warning }),
    ...(reason === undefined ? {} : { reason }),
  }
}

/**
 * A clone whose changes could not land is the user's only copy of that work, so it is renamed aside
 * instead of deleted. Without a handle (a crash salvaged by a later process) nothing is touched: the
 * startup sweep owns reclamation once the dead owner is proven.
 */
async function disposeWorkspace(input: SettleIsolationInput, result: IsolationMergeResult): Promise<void> {
  const handle = input.handle
  if (handle === undefined) return
  if (RETAINING_KINDS.has(result.kind)) {
    await input.runtime.retain(handle, result.kind)
    return
  }
  await input.runtime.cleanup(handle)
}
