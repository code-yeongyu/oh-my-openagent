import { join } from "node:path"

import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import type { FactsSandbox, FactsSpawnArgs } from "./worker/spawn"
import {
  SandboxUnavailableError,
  type SandboxPolicy,
  type SandboxTransform,
} from "./sandbox-contracts"
import { buildPathSandboxTransform } from "./sandbox-platform"

export {
  SandboxUnavailableError,
  type SandboxPolicy,
  type SandboxTransform,
} from "./sandbox-contracts"

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
  })
}

export function buildFactsSandboxTransform(input: {
  readonly policy: SandboxPolicy
  readonly foreignRoots?: readonly string[]
  readonly onWarning?: (warning: string, spawnArgs: FactsSpawnArgs) => void
  readonly errorRethrow?: (error: SandboxUnavailableError) => never
  readonly platform?: NodeJS.Platform
  readonly which?: (command: string) => string | undefined
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
    })
    if (transform.warning !== undefined) input.onWarning?.(transform.warning, spawnArgs)
    return transform(spawnArgs)
  }
}
