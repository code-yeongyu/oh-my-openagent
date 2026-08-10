import { homedir } from "node:os"
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
import type { SenpiOmoConfigResult } from "../config-resolution"
import type { MemoryIdentityContext } from "./context"
import { buildSandboxTransform, type SandboxPolicy, type SandboxTransform } from "./sandbox"
import { resolveReflectionTriggerConfig } from "./trigger-wiring"
import {
  SenpiSubprocessRunner,
  type ReflectionLiveSession,
  type ReflectionReservationPort,
} from "./worker"
import type { ReflectionSpawnArgs } from "./worker"
import type { OmoMemorySettings } from "@oh-my-opencode/omo-config-core"

const DEFAULT_MEMORY_SETTINGS: OmoMemorySettings = {
  enabled: true,
  agent: "auto",
  tool_exposure: "direct",
  reflection: {
    trigger: { step_count: 0, on_compaction: true },
    merge: "auto",
    category: "quick",
    timeout_minutes: 15,
    sandbox: "auto",
  },
  sync: { enabled: true },
  search: { enabled: true },
  compile_warn_tokens: 30000,
  agents: {},
}

export interface MemoryIdentityRuntimeDeps {
  readonly loadConfig: (options: { readonly cwd?: string }) => SenpiOmoConfigResult
  readonly cwd: () => string
  readonly resolveModelRegistry: () => SenpiModelRegistryPort<SenpiModelPort> | undefined
  readonly liveSession?: () => ReflectionLiveSession | undefined
  readonly logger?: ComponentLogger
}

export interface MemoryIdentityRuntime {
  readonly identity: MemoryIdentityContext
  readonly store: ReflectionReservationStore
  readonly reservationPort: ReflectionReservationPort
  readonly runner: SenpiSubprocessRunner
  launch(run: ReservedRun): void
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
  const settings = deps.loadConfig({ cwd: deps.cwd() }).config.memory ?? DEFAULT_MEMORY_SETTINGS
  const store = new ReflectionReservationStore({
    identity: asMemoryIdentity(identity),
    config: resolveReflectionTriggerConfig(settings, identity.identity),
    getJournal: async (conversationId: string) =>
      new TranscriptJournal({ journalDir: `${identity.identityPaths.transcripts}/${conversationId}` }),
    createRunId: () => `reflection-run-${++runCounter}`,
  })

  let builtSandbox: SandboxTransform | undefined
  const lazySandbox = (spawnArgs: ReflectionSpawnArgs): ReflectionSpawnArgs => {
    if (builtSandbox === undefined) {
      builtSandbox = buildSandboxTransform({
        policy: (settings.reflection?.sandbox ?? "auto") as SandboxPolicy,
        worktreeDir: identity.identityPaths.worktrees,
        gitCommonDir: identity.identityPaths.repo,
        payloadPaths: [identity.identityPaths.transcripts],
        runtimeWrites: [
          identity.identityPaths.reflectionSessions,
          identity.identityPaths.reflection,
          process.env.SENPI_CODING_AGENT_DIR ?? join(homedir(), ".senpi", "agent"),
          ...(process.env.XDG_CONFIG_HOME === undefined ? [] : [process.env.XDG_CONFIG_HOME]),
        ],
      })
    }
    return builtSandbox(spawnArgs)
  }

  const runtime: MemoryIdentityRuntime = {
    identity,
    store,
    reservationPort: store,
    runner: new SenpiSubprocessRunner({
      identity: asMemoryIdentity(identity),
      reservation: store,
      resolveModelRegistry: deps.resolveModelRegistry,
      cwd: deps.cwd(),
      sandbox: lazySandbox,
      ...(deps.liveSession === undefined ? {} : { liveSession: deps.liveSession }),
    }),
    launch(run: ReservedRun): void {
      void this.runner.launch(run).catch((error: unknown) => {
        deps.logger?.warn("memory reflection launch failed", { error: describe(error) })
      })
    },
  }
  return runtime
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
