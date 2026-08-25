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
import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import type { SenpiOmoConfigResult } from "../config-resolution"
import type { MemoryIdentityContext } from "./context"
import { ensureIdentityRuntimeDirs } from "./context"
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
  launch(run: ReservedRun): void
  reconcile(): Promise<void>
}

let runCounter = 0

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
    createRunId: () => `reflection-run-${++runCounter}`,
  })

  let builtSandbox: SandboxTransform | undefined
  const resolveAgentDir = deps.resolveAgentDir ?? (() => resolveAgentHome({ env: process.env }))
  const lazySandbox = (spawnArgs: ReflectionSpawnArgs): ReflectionSpawnArgs => {
    if (builtSandbox === undefined) {
      builtSandbox = buildSandboxTransform({
        policy: reflection.sandbox as SandboxPolicy,
        worktreeDir: identity.identityPaths.worktrees,
        gitCommonDir: identity.identityPaths.repo,
        payloadPaths: [identity.identityPaths.transcripts],
        runtimeWrites: [
          identity.identityPaths.reflectionSessions,
          identity.identityPaths.reflection,
          resolveAgentDir(),
          ...(process.env.XDG_CONFIG_HOME === undefined ? [] : [process.env.XDG_CONFIG_HOME]),
        ],
        command: spawnArgs.command,
        env: spawnArgs.env,
      })
      if (builtSandbox.warning !== undefined) {
        deps.logger?.warn("memory reflection sandbox degraded", {
          identity: identity.identity,
          runId: spawnArgs.runId,
          warning: builtSandbox.warning,
        })
      }
    }
    return builtSandbox(spawnArgs)
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
  // #7012 first-write seam: the lazy sandbox grants runtimeWrites including
  // identityPaths.reflectionSessions, and bwrap cannot bind an entry that does not exist
  // yet, so every launch must guarantee the identity runtime dirs (mkdir recursive)
  // before the runner can build the sandbox or spawn a child.
  let runtimeDirsReady: Promise<void> | undefined
  const ensureRuntimeDirsOnce = (): Promise<void> => {
    runtimeDirsReady ??= ensureIdentityRuntimeDirs(identity.identityPaths)
    return runtimeDirsReady
  }
  const launchAsync = (run: ReservedRun): Promise<void> =>
    ensureRuntimeDirsOnce()
      .then(() => runner.launch(run))
      .then((result) => {
        if (result.launch !== undefined) void launchAsync(result.launch)
      })
      .catch((error: unknown) => {
        deps.logger?.warn("memory reflection launch failed", { error: describe(error) })
      })
  const launch = (run: ReservedRun): void => {
    void launchAsync(run)
  }
  const runtime: MemoryIdentityRuntime = {
    identity,
    store,
    reservationPort: store,
    runner,
    launch,
    async reconcile(): Promise<void> {
      await reconcileReflectionRuns({ identity: asMemoryIdentity(identity), reservation: store, launch })
    },
  }
  return runtime
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
