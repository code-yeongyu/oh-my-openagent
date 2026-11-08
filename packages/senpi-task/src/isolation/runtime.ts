import { homedir } from "node:os"
import { join } from "node:path"

import {
  ApfsBackend,
  BlockCloneBackend,
  BtrfsBackend,
  OverlayfsBackend,
  RcopyBackend,
  ReflinkBackend,
  ZfsBackend,
  captureBaseline,
  captureDeltaPatch,
  cleanupIsolation,
  ensureIsolation,
  mergeIsolatedChanges,
  retainIsolation,
  runGit,
  sweepStaleIsolations,
  writeOwnerMarker,
  type DeltaPatchResult,
  type IsolationBackend,
  type IsolationHandle,
  type IsolationMergeOptions,
  type IsolationMergeResult as CoreMergeResult,
  type IsolationOwner,
  type OwnerProbe,
  type SweepResult,
  type WorktreeBaseline,
} from "@oh-my-opencode/isolation-core"
import type { IsolationBackendKind } from "@oh-my-opencode/omo-config-core"

export type { CoreMergeResult, IsolationHandle, IsolationOwner, OwnerProbe, SweepResult, WorktreeBaseline }

export type EnsureInput = {
  readonly repoRoot: string
  readonly id: string
  readonly preferred: IsolationBackendKind
  readonly owner?: IsolationOwner
}

/**
 * The isolation capability the task manager consumes, as a port. The production object below is the
 * real isolation-core; tests inject the same object with a temp `homeDir` so a clone never lands in
 * the developer's `~/.omo/wt`, and fake `probe`s so a sweep decision is deterministic.
 */
export type IsolationRuntime = {
  /** The git checkout that owns `cwd`, or null when `cwd` is not inside a git repository. */
  resolveRepoRoot(cwd: string): Promise<string | null>
  captureBaseline(repoRoot: string): Promise<WorktreeBaseline>
  ensure(input: EnsureInput): Promise<IsolationHandle>
  captureDelta(mergedDir: string, baseline: WorktreeBaseline): Promise<DeltaPatchResult>
  merge(options: IsolationMergeOptions): Promise<CoreMergeResult>
  cleanup(handle: IsolationHandle): Promise<void>
  retain(handle: IsolationHandle, reason: string): Promise<string>
  /** Re-stamp ownership once the child's identity (pid or host session) is known. */
  writeOwner(baseDir: string, id: string, owner: IsolationOwner): Promise<void>
  sweep(roots: readonly string[], probe: OwnerProbe): Promise<SweepResult>
  /** Where THIS runtime places clones; the startup sweep scans these plus any root seen on a record. */
  readonly sweepRoots: readonly string[]
}

/** Every backend this platform could pick, so a sweep can also tear down a clone it did not create. */
export function isolationBackends(): readonly IsolationBackend[] {
  return [
    new ApfsBackend(),
    new BtrfsBackend(),
    new ZfsBackend(),
    new ReflinkBackend(),
    new OverlayfsBackend(),
    new BlockCloneBackend(),
    new RcopyBackend(),
  ]
}

export function createIsolationRuntime(options: { readonly homeDir?: string } = {}): IsolationRuntime {
  const homeDir = options.homeDir ?? homedir()
  const backends = isolationBackends()
  return {
    async resolveRepoRoot(cwd) {
      try {
        const { stdout } = await runGit(["rev-parse", "--show-toplevel"], { cwd })
        const root = stdout.toString().trim()
        return root.length === 0 ? null : root
      } catch {
        return null
      }
    },
    captureBaseline: (repoRoot) => captureBaseline(repoRoot),
    ensure: (input) => ensureIsolation({
      repoRoot: input.repoRoot,
      id: input.id,
      preferred: input.preferred,
      backends,
      homeDir,
      ...(input.owner === undefined ? {} : { owner: input.owner }),
    }),
    captureDelta: (mergedDir, baseline) => captureDeltaPatch(mergedDir, baseline),
    merge: (mergeOptions) => mergeIsolatedChanges(mergeOptions),
    cleanup: (handle) => cleanupIsolation(handle),
    retain: (handle, reason) => retainIsolation(handle, reason),
    writeOwner: (baseDir, id, owner) => writeOwnerMarker(baseDir, id, owner),
    sweep: (roots, probe) => sweepStaleIsolations(roots, { backends, probe }),
    sweepRoots: [join(homeDir, ".omo", "wt")],
  }
}
