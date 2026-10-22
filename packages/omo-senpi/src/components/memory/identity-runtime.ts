import { join } from "node:path"

import {
  ReflectionReservationStore,
  TranscriptJournal,
  sanitizeToSlug,
  type MemoryIdentity,
  type ReservedRun,
} from "@oh-my-opencode/memory-core"
import type { SenpiModelRegistryPort, SenpiModelPort } from "@oh-my-opencode/senpi-task"

import type { ComponentLogger } from "../../extension/types"
import { AGENT_DIR_ENV_NAMES, resolveAgentHome } from "../agent-home/resolve-agent-home"
import type { SenpiOmoConfigResult } from "../config-resolution"
import { ensureIdentityRuntimeDirs, type MemoryIdentityContext } from "./context"
import { currentLaunchScope, withLaunchScope } from "./launch-facts"
import { createReflectionRunIdFactory } from "./reflection-run-id"
import { buildSandboxTransform, type SandboxPolicy, type SandboxTransform } from "./sandbox"
import {
  resolveAgentReflectionSettings,
  resolveMemorySettings,
} from "./reflection-settings"
import { resolveReflectionTriggerConfig } from "./trigger-wiring"
import {
  SenpiSubprocessRunner,
  reconcileReflectionRuns,
  type ReflectionLiveSession,
  type ReflectionReservationPort,
  type ReflectionSessionModel,
} from "./worker"
import type { ReflectionSpawnArgs } from "./worker"
export { resolveMemorySettings } from "./reflection-settings"

export interface MemoryIdentityRuntimeDeps {
  readonly loadConfig: (options: { readonly cwd?: string }) => SenpiOmoConfigResult
  readonly cwd: () => string
  readonly resolveModelRegistry: () => SenpiModelRegistryPort<SenpiModelPort> | undefined
  readonly resolveSessionModel?: () => ReflectionSessionModel | undefined
  readonly resolveParentContextTokens?: () => number | undefined
  readonly resolveParentSessionFile?: () => string | undefined
  readonly resolveParentCacheReusable?: () => boolean
  readonly liveSession?: () => ReflectionLiveSession | undefined
  readonly logger?: ComponentLogger
  /** Agent home resolved for the sandbox writable grant; defaults to resolveAgentHome on process.env. */
  readonly resolveAgentDir?: () => string
}

export interface MemoryIdentityRuntime {
  readonly identity: MemoryIdentityContext
  readonly store: ReflectionReservationStore
  readonly reservationPort: ReflectionReservationPort
  readonly runner: SenpiSubprocessRunner
  launch(run: ReservedRun): Promise<void>
  reconcile(): Promise<void>
  /** Resolves once every launch started in this process has returned (a detached child may still be running). */
  settled(): Promise<void>
}

function asMemoryIdentity(context: MemoryIdentityContext): MemoryIdentity {
  return {
    id: context.identity,
    safeSlug: sanitizeToSlug(context.identity),
    paths: context.identityPaths,
  }
}

export function createIdentityRuntime(
  identity: MemoryIdentityContext,
  deps: MemoryIdentityRuntimeDeps,
): MemoryIdentityRuntime {
  const settings = resolveMemorySettings(deps.loadConfig({ cwd: deps.cwd() }).config.memory)
  const reflection = resolveAgentReflectionSettings(settings, identity.identity)
  const store = new ReflectionReservationStore({
    identity: asMemoryIdentity(identity),
    config: resolveReflectionTriggerConfig(settings, identity.identity),
    getJournal: async (conversationId: string) =>
      new TranscriptJournal({ journalDir: `${identity.identityPaths.transcripts}/${conversationId}` }),
    createRunId: createReflectionRunIdFactory({ identityPaths: identity.identityPaths }),
  })

  let sandboxState: { readonly transform: SandboxTransform; readonly agentDir: string } | undefined
  const resolveAgentDir = deps.resolveAgentDir ?? (() => resolveAgentHome({ env: process.env }))
  const lazySandbox = async (spawnArgs: ReflectionSpawnArgs): Promise<ReflectionSpawnArgs> => {
    if (sandboxState === undefined) {
      const agentDir = resolveAgentDir()
      const transform = buildSandboxTransform({
        policy: reflection.sandbox as SandboxPolicy,
        worktreeDir: identity.identityPaths.worktrees,
        gitCommonDir: identity.identityPaths.repo,
        payloadPaths: [identity.identityPaths.transcripts],
        runtimeWrites: [
          identity.identityPaths.reflectionSessions,
          identity.identityPaths.reflection,
          agentDir,
          ...(process.env.XDG_CONFIG_HOME === undefined ? [] : [process.env.XDG_CONFIG_HOME]),
        ],
        command: spawnArgs.command,
        env: spawnArgs.env,
      })
      if (transform.warning !== undefined) {
        deps.logger?.warn("memory reflection sandbox degraded", {
          identity: identity.identity,
          runId: spawnArgs.runId,
          warning: transform.warning,
        })
      }
      // The grant and the pin below come from ONE resolution, so the directory the child locks
      // its credentials in can never drift away from the directory the sandbox granted.
      sandboxState = { transform, agentDir }
    }
    const transformed = await sandboxState.transform(spawnArgs)
    return { ...transformed, env: { ...transformed.env, ...pinnedAgentDirEnv(sandboxState.agentDir) } }
  }

  const runner = new SenpiSubprocessRunner({
    identity: asMemoryIdentity(identity),
    reservation: store,
    logger: deps.logger,
    resolveModelRegistry: deps.resolveModelRegistry,
    ...(deps.resolveSessionModel === undefined ? {} : { resolveSessionModel: deps.resolveSessionModel }),
    ...(deps.resolveParentContextTokens === undefined ? {} : { resolveParentContextTokens: deps.resolveParentContextTokens }),
    ...(deps.resolveParentSessionFile === undefined ? {} : { resolveParentSessionFile: deps.resolveParentSessionFile }),
    ...(deps.resolveParentCacheReusable === undefined ? {} : { resolveParentCacheReusable: deps.resolveParentCacheReusable }),
    loadConfig: (options) => deps.loadConfig(options ?? {}),
    cwd: deps.cwd(),
    sandbox: lazySandbox,
    getTranscriptState: async (conversationId) =>
      new TranscriptJournal({ journalDir: join(identity.identityPaths.transcripts, conversationId) }).getState(),
    ...(deps.liveSession === undefined ? {} : { liveSession: deps.liveSession }),
  })
  // #7012: identities created before newer layout entries never got runtime/reflection-sessions
  // (and other runtime dirs), and the lazy sandbox binds them writable, so bwrap died with
  // "Can't find source path". Backfill every identity runtime dir once per runtime, before the
  // runner can build the sandbox or spawn. Ported from #7236 by @AceRothstein71.
  // A failed backfill must never be cached: forget it so the next launch retries, tell the user
  // why in plain words with the next step, and still launch (the sandbox creates each directory it
  // binds itself, so reflection keeps working for every directory that can exist).
  let runtimeDirsReady: Promise<void> | undefined
  const ensureRuntimeDirsOnce = (): Promise<void> => {
    runtimeDirsReady ??= ensureIdentityRuntimeDirs(identity.identityPaths).catch((error: unknown) => {
      runtimeDirsReady = undefined
      deps.logger?.warn(
        `memory reflection could not create its runtime directories under ${identity.identityPaths.root}: ${describe(error)}. Check that this directory is writable (permissions, free disk space); reflection keeps running and retries on the next run.`,
      )
    })
    return runtimeDirsReady
  }
  const inFlight = new Set<Promise<void>>()
  // Every launch runs in a scope bound to ITS run (launch-facts.ts): a trigger's own scope is kept
  // when it is for this run; a queued follow-up or a reconcile gets a fresh scope of its own.
  const launch = (run: ReservedRun): Promise<void> => {
    const scope = currentLaunchScope()
    const owned = scope !== undefined && sameConversations(scope.conversationIds, run.request.conversationIds)
    return owned ? launchInScope(run) : withLaunchScope({ conversationIds: run.request.conversationIds }, () => launchInScope(run))
  }
  const launchInScope = (run: ReservedRun): Promise<void> => {
    const tracked: Promise<void> = ensureRuntimeDirsOnce()
      .then(() => runner.launch(run))
      .then((result) => {
        if (result.launch !== undefined) void launch(result.launch)
      })
      .catch((error: unknown) => {
        deps.logger?.warn("memory reflection launch failed", { error: describe(error) })
      })
      .finally(() => inFlight.delete(tracked))
    inFlight.add(tracked)
    return tracked
  }

  const runtime: MemoryIdentityRuntime = {
    identity,
    store,
    reservationPort: store,
    runner,
    launch,
    async settled(): Promise<void> {
      while (inFlight.size > 0) await Promise.all([...inFlight])
    },
    async reconcile(): Promise<void> {
      await reconcileReflectionRuns({
        identity: asMemoryIdentity(identity),
        reservation: store,
        launch,
        deferOnSchedulerContention: true,
      })
    },
  }
  return runtime
}

/**
 * Pins the granted agent dir under every name the engine reads.
 *
 * The child's cwd is the reflection worktree, so without a pin it re-resolves its own agent dir
 * - and an inherited value under the brand prefix would beat a legacy-only pin, because the
 * engine takes the first DEFINED name across `<brand>`, `SENPI`, `PI`.
 */
function pinnedAgentDirEnv(agentDir: string): NodeJS.ProcessEnv {
  return Object.fromEntries(AGENT_DIR_ENV_NAMES.map((name) => [name, agentDir]))
}

function sameConversations(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id))
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
