import type { ToolDefinition } from "@code-yeongyu/senpi"
import type { OmoConfig, OmoTaskSettings } from "@oh-my-opencode/omo-config-core"
import {
  BUILTIN_AGENTS,
  CURATED_READONLY_AGENT_NAMES,
  InProcessRunner,
  ULW_REVIEWER_AGENT_NAMES,
  RpcHostRunner,
  RpcProcessRunner,
  createInProcessManagedRunner,
  createParentRegistrySessionContext,
  createRpcManagedRunner,
  mapOmoConfigAgents,
  parseExtensionEntries,
  selectPackageExtensionPaths,
  type AgentDefinition,
  type KernelToolBindingRegistry,
  type ManagedRunner,
  type RpcChildHandle,
  type RpcRunnerSpec,
} from "@oh-my-opencode/senpi-task"

import { log } from "@oh-my-opencode/utils"

import { loadSenpiBarrel } from "../../../../senpi-task/src/lazy/senpi-barrel"
import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import type { TaskRuntimeContext } from "./runtime-context"
import type { TaskHostRouting } from "./shard-routing"

// Question tools need a parent user UI. Memory stays available to match process children; its
// invocation context supplies the child session identity while the shared definition preserves the
// parent's live service/client instances.
export const TASK_CHILD_UI_ONLY_TOOL_NAMES: readonly string[] = [
  "request_user_input",
  "ask_user_question",
]

export interface RunnerBuildContext {
  readonly runtime: TaskRuntimeContext
  readonly sharedParentTools: () => readonly ToolDefinition[]
  readonly settings: OmoTaskSettings
  // The engine's runtime-only parent kernel-tool map (item 6); absent in bare test wirings.
  readonly kernelToolBindings?: KernelToolBindingRegistry
  // Where the shared daemon lives and which platform decides it can be used. Injected so a suite
  // can pin the win32 branch without pretending to run on Windows; both default to this process.
  readonly platform?: NodeJS.Platform
  readonly agentDir?: string
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly listInstalledPackageRoots?: () => readonly string[]
  // The session's shared package-aware inherited list. Injected so every child-launch producer -
  // initial spawn, revival, team members, workpool workers - resolves the SAME list.
  readonly resolveInheritedExtensions?: () => Promise<readonly string[]>
  // Where a daemon fallback reason goes. Defaults to the module logger; the engine passes the
  // session's deduped notice list so the same reason reaches `task_output` exactly once.
  readonly onHostWarning?: (message: string) => void | (() => void)
  // WHERE this session's `process` children open (its own task host) and the task store the index
  // records. The engine always passes it; the host runner cannot be built without it.
  readonly hostRouting?: TaskHostRouting
}

export interface TaskRunnerFactories {
  readonly inProcess: (context: RunnerBuildContext) => ManagedRunner
  readonly process: (context: RunnerBuildContext) => ManagedRunner
}

export const DEFAULT_RUNNER_FACTORIES: TaskRunnerFactories = {
  inProcess: buildInProcessRunner,
  process: buildProcessRunner,
}

export function resolveTaskAgents(config: OmoConfig): Readonly<Record<string, AgentDefinition>> {
  const merged: Record<string, AgentDefinition> = { ...BUILTIN_AGENTS }
  for (const [name, definition] of Object.entries(mapOmoConfigAgents(config))) {
    merged[name] = { ...merged[name], ...definition }
  }
  for (const name of CURATED_READONLY_AGENT_NAMES) {
    const definition = merged[name]
    if (definition !== undefined) merged[name] = { ...definition, executionMode: "in-process" }
  }
  for (const name of ULW_REVIEWER_AGENT_NAMES) {
    const definition = merged[name]
    if (definition !== undefined) merged[name] = { ...definition, executionMode: "in-process" }
  }
  return merged
}

function buildInProcessRunner(build: RunnerBuildContext): ManagedRunner {
  const inProcess = new InProcessRunner({
    get sharedParentTools(): readonly ToolDefinition[] {
      return build.sharedParentTools()
    },
    uiOnlyToolNames: TASK_CHILD_UI_ONLY_TOOL_NAMES,
    depthPolicy: { maxDepth: Math.max(build.settings.max_depth + 1, 1) },
    ...(build.kernelToolBindings === undefined ? {} : { kernelToolBindings: build.kernelToolBindings }),
  })
  const context = createParentRegistrySessionContext(
    () => build.runtime.modelRegistry(),
    () => build.runtime.projectTrusted(),
  )
  return createInProcessManagedRunner(inProcess, context)
}

// Package discovery reads settings and stats every installed package root. On a stuck mount that
// can block rather than throw, and it sits directly in front of every child spawn, so it is bounded
// and the child falls back to argv-only instead of never starting.
const PACKAGE_DISCOVERY_TIMEOUT_MS = 5_000

async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * The ONE answer to "which extensions should a child of this session inherit".
 *
 * Every producer of a child launch list - the initial spawn, revival, team members, workpool
 * workers - resolves through this, because a list assembled from argv alone is exactly the #8492
 * defect.
 *
 * Both inputs are read fresh on every call, never memoized: a package installed mid-session and an
 * extension registered after the last capture must both reach the next child. That freshness is a
 * pinned contract (`package-extensions.test.ts` asserts a changed root set between two spawns is
 * picked up), so the cost of the lookup is bounded by a timeout instead of by a cache.
 */
export function createInheritedExtensionsResolver(build: RunnerBuildContext): () => Promise<readonly string[]> {
  const argvEntries = parseExtensionEntries(process.argv)

  const discoverRoots = async (): Promise<readonly string[]> => {
    if (build.listInstalledPackageRoots !== undefined) return build.listInstalledPackageRoots()
    const { DefaultPackageManager, SettingsManager } = await loadSenpiBarrel()
    const cwd = build.runtime.cwd()
    const agentDir = build.agentDir ?? resolveAgentHome({ env: build.env ?? process.env })
    return new DefaultPackageManager({
      cwd,
      agentDir,
      settingsManager: SettingsManager.create(cwd, agentDir),
    }).listConfiguredPackages().flatMap(({ installedPath }) => installedPath === undefined ? [] : [installedPath])
  }

  return async () => {
    const loadedExtensionPaths = build.runtime.loadedExtensionPaths()
    if (loadedExtensionPaths.length === 0) return argvEntries
    let installedPackageRoots: readonly string[] = []
    try {
      installedPackageRoots = await withTimeout(discoverRoots(), PACKAGE_DISCOVERY_TIMEOUT_MS, "package discovery")
    } catch (error) { // no-excuse-ok: catch - discovery is best-effort and must never block a spawn.
      log("omo-senpi package extension discovery failed; task children inherit argv extensions only", {
        error: String(error),
      })
      installedPackageRoots = []
    }
    return [
      ...argvEntries,
      ...selectPackageExtensionPaths(argvEntries, loadedExtensionPaths, installedPackageRoots),
    ]
  }
}

function buildProcessRunner(build: RunnerBuildContext): ManagedRunner {
  const runner = buildProcessChildRunner(build)
  const resolveInheritedExtensions = build.resolveInheritedExtensions ?? createInheritedExtensionsResolver(build)
  return createRpcManagedRunner({
    async start(spec) {
      if (spec.extensions !== undefined) return runner.start(spec)
      return runner.start({ ...spec, extensions: await resolveInheritedExtensions() })
    },
  })
}

/**
 * The respawn seam. `TaskManagerImpl` otherwise defaults to a bare `new RpcProcessRunner()`, which
 * carries no inherited extensions at all, so a revived child lost every package provider its first
 * launch had and failed admission against the model recorded in its own record.
 */
export function buildRespawnRunner(
  build: RunnerBuildContext,
): { start(spec: RpcRunnerSpec): Promise<RpcChildHandle> } {
  const runner = buildProcessChildRunner(build)
  const resolveInheritedExtensions = build.resolveInheritedExtensions ?? createInheritedExtensionsResolver(build)
  return {
    start: async (spec) => runner.start(
      spec.extensions === undefined ? { ...spec, extensions: await resolveInheritedExtensions() } : spec,
    ),
  }
}

/**
 * WHICH runner a `process` child gets. The default is a session of this session's OWN task host
 * (its shard); `task.process_runner: "child-process"` and win32 (no host runner path there) keep the
 * per-child process runner, which is also the host runner's loud fallback for the narrow set of
 * reasons the engine marks fallback-allowed. There is no shared-host branch.
 */
export function buildProcessChildRunner(build: RunnerBuildContext): RpcHostRunner | RpcProcessRunner {
  const inheritedExtensions = parseExtensionEntries(process.argv)
  const perChild = new RpcProcessRunner({ inheritedExtensions })
  const platform = build.platform ?? process.platform
  if (build.settings.process_runner !== "host" || platform === "win32") return perChild
  const routing = build.hostRouting
  if (routing === undefined) throw new Error("omo-senpi task host runner built without the session's shard routing")
  const env = build.env ?? process.env
  return new RpcHostRunner({
    policy: build.settings.host_engine_policy,
    agentDir: build.agentDir ?? resolveAgentHome({ env }),
    env,
    inheritedExtensions,
    fallback: perChild,
    ...(build.onHostWarning === undefined ? {} : { onWarning: build.onHostWarning }),
    ensureDaemon: routing.ensureDaemon,
    shardResolver: () => routing.shardResolver(),
    storeDir: routing.storeDir,
    ownHostSocket: routing.ownHostSocket,
    insideHost: routing.insideHost,
    onNotice: routing.onNotice,
    shardEvents: routing.shardEvents,
    liveChildren: routing.liveChildren,
    probeHost: routing.probeHost,
  })
}
