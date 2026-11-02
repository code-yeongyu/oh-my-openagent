import { AsyncLocalStorage } from "node:async_hooks"

import { resolveMemoryModelRegistry, type ChildModelRegistry } from "./model-registry-resolver"
import { resolveMemorySessionModel } from "./session-model-resolver"
import {
  resolveParentCacheReusable,
  resolveParentContextTokens,
  resolveParentSessionFile,
  resolveSessionAgentDir,
} from "./session-context-resolver"
import type { ReflectionSessionModel } from "./worker"

/** What a reflection launch needs from the session that triggered it. */
export interface LaunchFacts {
  readonly modelRegistry: ChildModelRegistry | undefined
  readonly sessionModel: ReflectionSessionModel | undefined
  readonly parentContextTokens: number | undefined
  readonly parentSessionFile: string | undefined
  readonly parentCacheReusable: boolean
  readonly agentDir: string | undefined
}

export const NO_LAUNCH_FACTS: LaunchFacts = {
  modelRegistry: undefined,
  sessionModel: undefined,
  parentContextTokens: undefined,
  parentSessionFile: undefined,
  parentCacheReusable: false,
  agentDir: undefined,
}

export function readLaunchFacts(eventContext: unknown): LaunchFacts {
  return {
    modelRegistry: resolveMemoryModelRegistry(eventContext),
    sessionModel: resolveMemorySessionModel(eventContext),
    parentContextTokens: resolveParentContextTokens(eventContext),
    parentSessionFile: resolveParentSessionFile(eventContext),
    parentCacheReusable: resolveParentCacheReusable(eventContext),
    agentDir: resolveSessionAgentDir(eventContext),
  }
}

/**
 * The facts a reflection launch may use, bound to the run.
 *
 * A launch reads its facts asynchronously, long after the trigger handler returned. By then the
 * triggering ctx may be retired, or another session's ctx may be the current one (#10339). Reading
 * a shared "current" ctx there is a cross-session leak: one session's transcript, model or agent dir
 * reaching another session's reflection. So each launch runs inside a scope bound to its run:
 * - a trigger launch carries an immutable snapshot taken from the triggering session's live ctx, and
 *   reads only that;
 * - any other launch (bind-time reconcile, a queued follow-up, a dream) carries the run's own
 *   conversation ids, and session-specific facts are taken from the current ctx only when that ctx
 *   IS one of those conversations. Otherwise the launch gets none (only the process-wide model
 *   registry, which no session owns).
 */
export interface LaunchScope {
  readonly conversationIds: readonly string[]
  readonly snapshot?: LaunchFacts
}

const launchScope = new AsyncLocalStorage<LaunchScope>()

export function withLaunchScope<T>(scope: LaunchScope, launch: () => T): T {
  return launchScope.run({ conversationIds: [...scope.conversationIds], ...(scope.snapshot === undefined ? {} : { snapshot: Object.freeze({ ...scope.snapshot }) }) }, launch)
}

export function currentLaunchScope(): LaunchScope | undefined {
  return launchScope.getStore()
}

/** Facts for a launch from the current ctx, restricted to what the run's own conversations may see. */
export function factsForScope(scope: LaunchScope, currentSessionId: string | undefined, live: LaunchFacts): LaunchFacts {
  if (scope.snapshot !== undefined) return scope.snapshot
  if (currentSessionId !== undefined && scope.conversationIds.includes(currentSessionId)) return live
  return { ...NO_LAUNCH_FACTS, modelRegistry: live.modelRegistry }
}
