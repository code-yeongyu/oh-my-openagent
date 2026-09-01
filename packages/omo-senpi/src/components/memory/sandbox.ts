import { join } from "node:path"

import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import type { FactsSandbox, FactsSpawnArgs, MemorianSandbox, MemorianSpawnArgs } from "./worker/spawn"
import {
  SandboxUnavailableError,
  type SandboxPolicy,
  type SandboxTransform,
} from "./sandbox-contracts"
import { buildPathSandboxTransform, type SandboxUsability } from "./sandbox-platform"

export {
  SandboxUnavailableError,
  type SandboxPolicy,
  type SandboxTransform,
} from "./sandbox-contracts"
export type { SandboxUsability } from "./sandbox-platform"

export function buildSandboxTransform(input: {
  readonly policy: SandboxPolicy
  readonly worktreeDir: string
  readonly gitCommonDir: string
  readonly payloadPaths: readonly string[]
  readonly runtimeWrites?: readonly string[]
  readonly foreignRoots?: readonly string[]
  readonly command: string
  readonly env: NodeJS.ProcessEnv
  readonly errorRethrow?: (error: SandboxUnavailableError) => never
  readonly platform?: NodeJS.Platform
  readonly which?: (command: string) => string | undefined
  readonly probe?: (executable: string) => SandboxUsability
}): SandboxTransform {
  return buildPathSandboxTransform({
    surface: "reflection",
    policy: input.policy,
    writableDirs: [
      input.worktreeDir,
      input.gitCommonDir,
      ...(input.runtimeWrites ?? []),
    ],
    payloadPaths: input.payloadPaths,
    fallbackDir: input.worktreeDir,
    foreignRoots: input.foreignRoots,
    command: input.command,
    env: input.env,
    errorRethrow: input.errorRethrow,
    platform: input.platform,
    which: input.which,
    probe: input.probe,
  })
}

/**
 * The memorian gate child gets the facts child's confinement: its run dir is the only writable
 * tree, senpi's own settings/auth locks stay takeable, and the read-only payload files are granted
 * explicitly. Same `memory.reflection.sandbox` policy - the gate adds no knob of its own.
 */
export function buildMemorianSandboxTransform(input: {
  readonly policy: SandboxPolicy
  readonly foreignRoots?: readonly string[]
  readonly onWarning?: (warning: string, spawnArgs: MemorianSpawnArgs) => void
  readonly errorRethrow?: (error: SandboxUnavailableError) => never
  readonly platform?: NodeJS.Platform
  readonly which?: (command: string) => string | undefined
  readonly probe?: (executable: string) => SandboxUsability
}): MemorianSandbox {
  return (spawnArgs) => {
    const agentDir = resolveAgentHome({ env: spawnArgs.env })
    const transform = buildPathSandboxTransform<MemorianSpawnArgs>({
      surface: "memorian",
      policy: input.policy,
      writableDirs: [spawnArgs.paths.runDir],
      lockPaths: [join(agentDir, "settings.json.lock"), join(agentDir, "auth.json.lock")],
      payloadPaths: [spawnArgs.paths.candidates, spawnArgs.paths.transcript],
      fallbackDir: spawnArgs.paths.runDir,
      foreignRoots: input.foreignRoots,
      command: spawnArgs.command,
      env: spawnArgs.env,
      errorRethrow: input.errorRethrow,
      platform: input.platform,
      which: input.which,
      probe: input.probe,
    })
    if (transform.warning !== undefined) input.onWarning?.(transform.warning, spawnArgs)
    return transform(spawnArgs)
  }
}

export function buildFactsSandboxTransform(input: {
  readonly policy: SandboxPolicy
  readonly foreignRoots?: readonly string[]
  readonly onWarning?: (warning: string, spawnArgs: FactsSpawnArgs) => void
  readonly errorRethrow?: (error: SandboxUnavailableError) => never
  readonly platform?: NodeJS.Platform
  readonly which?: (command: string) => string | undefined
  readonly probe?: (executable: string) => SandboxUsability
}): FactsSandbox {
  return (spawnArgs) => {
    // The child only needs to take senpi's own settings/auth locks; the agent dir itself stays
    // read-only so auth.json and settings.json cannot be rewritten by a misbehaving child.
    const agentDir = resolveAgentHome({ env: spawnArgs.env })
    const transform = buildPathSandboxTransform<FactsSpawnArgs>({
      surface: "facts",
      policy: input.policy,
      writableDirs: [spawnArgs.paths.runDir],
      lockPaths: [join(agentDir, "settings.json.lock"), join(agentDir, "auth.json.lock")],
      payloadPaths: [spawnArgs.paths.payload],
      fallbackDir: spawnArgs.paths.runDir,
      foreignRoots: input.foreignRoots,
      command: spawnArgs.command,
      env: spawnArgs.env,
      errorRethrow: input.errorRethrow,
      platform: input.platform,
      which: input.which,
      probe: input.probe,
    })
    if (transform.warning !== undefined) input.onWarning?.(transform.warning, spawnArgs)
    return transform(spawnArgs)
  }
}
