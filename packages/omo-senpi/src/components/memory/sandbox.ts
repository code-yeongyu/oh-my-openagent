import { join } from "node:path"

import type { ReflectionSpawnArgs } from "./worker/spawn"
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
  // The reflection child needs no lock grant: identity-runtime already lists the whole agent
  // directory under runtimeWrites, so senpi's settings/auth/hooks-state locks are writable there.
  // Resolving the agent home here would read process-wide state the caller never passed and, on a
  // host whose agent dir does not exist yet, degrade the sandbox to identity.
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
