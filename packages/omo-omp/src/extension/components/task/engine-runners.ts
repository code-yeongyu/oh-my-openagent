import type { OmoToolDefinition } from "../../types"
import { existsSync } from "node:fs"
import { delimiter, join } from "node:path"
import type { OmoConfig, OmoTaskSettings } from "@oh-my-opencode/omo-config-core"
import {
  BUILTIN_AGENTS,
  CURATED_READONLY_AGENT_NAMES,
  RpcProcessRunner,
  buildRpcSpawn,
  createRpcManagedRunner,
  mapOmoConfigAgents,
  parseExtensionEntries,
  type AgentDefinition,
  type ManagedRunner,
  type RpcSpawnRuntime,
} from "@oh-my-opencode/senpi-task"

import { MEMORY_APPLY_PATCH_TOOL_NAME, MEMORY_TOOL_NAME } from "../memory/tools"
import type { TaskRuntimeContext } from "./runtime-context"

// Memory tools are bound to the parent session's identity (repo commits + writer lock); a task
// child must never inherit them, so they ride the same ui-only exclusion as render-only tools.
export const TASK_CHILD_UI_ONLY_TOOL_NAMES: readonly string[] = [MEMORY_TOOL_NAME, MEMORY_APPLY_PATCH_TOOL_NAME]

export interface RunnerBuildContext {
  readonly runtime: TaskRuntimeContext
  readonly sharedParentTools: () => readonly OmoToolDefinition[]
  readonly settings: OmoTaskSettings
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
  return merged
}

function buildInProcessRunner(build: RunnerBuildContext): ManagedRunner {
  // The senpi-task InProcessRunner hosts a child agent session INSIDE the parent process by driving
  // the @code-yeongyu/senpi engine (createAgentSession). That engine is a different harness and is
  // deliberately NOT bundled into the omo-omp extension (it would add ~16 MB of senpi runtime and its
  // model-provider SDKs to every omp boot). Task children therefore run as real OMP child sessions
  // through the process runner — same shared-tool seam, correct harness semantics.
  return buildProcessRunner(build)
}

function buildProcessRunner(_build: RunnerBuildContext): ManagedRunner {
  return createRpcManagedRunner(new RpcProcessRunner({
    inheritedExtensions: parseExtensionEntries(process.argv),
    // The RPC child is a real OMP session (`omp --mode rpc --no-extensions --extension <member> ...`;
    // omp supports the same mode flags as senpi, see cli/args.ts Mode). senpi-task's default spawn
    // resolution looks for the SENPI binary — inject an OMP resolver so the child launches the omp
    // CLI instead, and mirror the session-dir isolation env to omp's name (PI_CODING_AGENT_SESSION_DIR).
    buildSpawn: (spec) => {
      const descriptor = buildRpcSpawn(spec, { resolveSenpiExecutable: resolveOmpExecutable })
      return {
        ...descriptor,
        env: {
          ...descriptor.env,
          PI_CODING_AGENT_SESSION_DIR: descriptor.env.SENPI_CODING_AGENT_SESSION_DIR,
        },
      }
    },
  }))
}

function resolveOmpExecutable(runtime: RpcSpawnRuntime): string | null {
  // Mirror senpi-task's own executable resolution, pointed at the omp CLI: an explicit OMP_BIN
  // override wins, then a PATH scan for omp/omp.exe (the extension runs inside the omp process, so
  // PATH lookup is the portable default for spawning a sibling omp child).
  const binaryName = runtime.platform === "win32" ? "omp.exe" : "omp"
  const override = runtime.parentEnv.OMP_BIN?.trim()
  if (override !== undefined && override.length > 0) {
    if (override.includes("/") || override.includes("\\") || !isRelativeOverride(override)) {
      return existsSync(override) ? override : null
    }
    const candidate = scanPath(override, runtime.parentEnv.PATH)
    return candidate === undefined ? null : candidate
  }
  return scanPath(binaryName, runtime.parentEnv.PATH) ?? null
}

function isRelativeOverride(value: string): boolean {
  return !value.includes("/") && !value.includes("\\")
}

function scanPath(name: string, pathValue: string | undefined): string | undefined {
  for (const dir of (pathValue ?? "").split(delimiter)) {
    if (dir.length === 0) continue
    const candidate = join(dir, name)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}
