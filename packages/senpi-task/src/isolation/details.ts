import type { IsolationBackendKind } from "@oh-my-opencode/omo-config-core"

import type { TaskRecord } from "../state"

export type IsolationDetails = {
  readonly backend: IsolationBackendKind
  readonly fell_back?: boolean
  readonly changes_applied: boolean
  readonly kind: string
  readonly partial?: boolean
  readonly patch_path?: string
  readonly nested_patch_paths?: readonly string[]
  readonly branch_name?: string
  readonly summary_path?: string
  readonly files_changed?: number
  readonly conflict?: string
  readonly manual_command?: string
  readonly reason?: string
}

export type IsolationStartedDetails = {
  readonly backend: IsolationBackendKind
  readonly merged_dir: string
}

/** Every result builder projects the SAME persisted facts, so a caller never sees two isolation stories. */
export function isolationDetails(record: TaskRecord): IsolationDetails | undefined {
  const isolation = record.isolation
  const merge = isolation?.merge_result
  if (isolation === undefined || merge === undefined) return undefined
  return {
    backend: isolation.backend,
    ...(isolation.fell_back === undefined ? {} : { fell_back: isolation.fell_back }),
    changes_applied: merge.changesApplied,
    kind: merge.kind,
    ...(merge.partial === undefined ? {} : { partial: merge.partial }),
    ...(merge.patchPath === undefined ? {} : { patch_path: merge.patchPath }),
    ...(merge.nestedPatchPaths === undefined ? {} : { nested_patch_paths: merge.nestedPatchPaths }),
    ...(merge.branchName === undefined ? {} : { branch_name: merge.branchName }),
    ...(merge.summaryPath === undefined ? {} : { summary_path: merge.summaryPath }),
    ...(merge.filesChanged === undefined ? {} : { files_changed: merge.filesChanged }),
    ...(merge.conflict === undefined ? {} : { conflict: merge.conflict }),
    ...(merge.manualCommand === undefined ? {} : { manual_command: merge.manualCommand }),
    ...(merge.reason === undefined ? {} : { reason: merge.reason }),
  }
}

export function isolationLine(details: IsolationDetails): string {
  const target = details.patch_path === undefined ? "" : ` -> ${details.patch_path}`
  return `isolation: ${details.kind} via ${details.backend}${target}`
}
