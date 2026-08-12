import type { ReflectionWorktree, ReservedRun } from "@oh-my-opencode/memory-core"

import type { ReflectionSpawnArgs } from "./spawn-types"

export function requireRunMetadata(spawnArgs: ReflectionSpawnArgs): {
  readonly runId: string
  readonly kind: "reflection" | "dream"
  readonly trigger: ReservedRun["request"]["trigger"]
  readonly origin?: "manual" | "idle" | "shutdown"
  readonly mergePolicy: "auto" | "integration"
  readonly targetDoc?: string
  readonly worktree: ReflectionWorktree
} {
  const { runId, kind, trigger, origin, mergePolicy, targetDoc, worktree } = spawnArgs
  if (runId === undefined || kind === undefined || trigger === undefined || mergePolicy === undefined || worktree === undefined) {
    throw new TypeError("reflection spawn metadata is required")
  }
  if ((kind === "dream") !== (trigger === "dream") || (kind === "dream" && origin === undefined)) {
    throw new TypeError("dream spawn metadata requires trigger and origin")
  }
  if (targetDoc !== undefined && kind !== "dream") throw new TypeError("dream target metadata requires a dream run")
  return {
    runId,
    kind,
    trigger,
    ...(origin === undefined ? {} : { origin }),
    mergePolicy,
    ...(targetDoc === undefined ? {} : { targetDoc }),
    worktree,
  }
}
