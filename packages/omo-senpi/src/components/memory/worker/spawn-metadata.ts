import type { ReflectionWorktree, ReservedRun } from "@oh-my-opencode/memory-core"

import type { ReflectionSpawnArgs } from "./spawn-types"

export function requireRunMetadata(spawnArgs: ReflectionSpawnArgs): {
  readonly runId: string
  readonly kind: "reflection" | "dream"
  readonly trigger: ReservedRun["request"]["trigger"]
  readonly origin?: "manual" | "idle" | "shutdown" | "pressure"
  readonly mergePolicy: "auto" | "integration"
  readonly targetDoc?: string
  readonly systemTokenBudget?: number
  readonly systemTokenTarget?: number
  readonly worktree: ReflectionWorktree
} {
  const { runId, kind, trigger, origin, mergePolicy, targetDoc, systemTokenBudget, systemTokenTarget, worktree } = spawnArgs
  if (runId === undefined || kind === undefined || trigger === undefined || mergePolicy === undefined || worktree === undefined) {
    throw new TypeError("reflection spawn metadata is required")
  }
  if ((kind === "dream") !== (trigger === "dream")
    || (kind === "dream" && (origin === undefined || systemTokenBudget === undefined || systemTokenTarget === undefined))) {
    throw new TypeError("dream spawn metadata requires trigger, origin, and system token budget")
  }
  if (targetDoc !== undefined && kind !== "dream") throw new TypeError("dream target metadata requires a dream run")
  return {
    runId,
    kind,
    trigger,
    ...(origin === undefined ? {} : { origin }),
    mergePolicy,
    ...(targetDoc === undefined ? {} : { targetDoc }),
    ...(systemTokenBudget === undefined ? {} : { systemTokenBudget }),
    ...(systemTokenTarget === undefined ? {} : { systemTokenTarget }),
    worktree,
  }
}
