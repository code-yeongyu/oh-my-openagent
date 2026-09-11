import { existsSync, realpathSync } from "@oh-my-opencode/memory-core/fs"
import { createRequire } from "node:module"
import { isAbsolute, join, relative } from "node:path"

import {
  detectBunBinary,
  detectCompiledEngine,
  resolveSenpiLauncher as resolveTaskSenpiLauncher,
  type SenpiLauncher,
} from "@oh-my-opencode/senpi-task"

const SENPI_PACKAGE_DIR = join("@code-yeongyu", "senpi")
const CLI_RELATIVE = join("dist", "cli.js")

/**
 * Resolve the senpi CLI to spawn reflection, dream, and facts children with.
 *
 * The previous resolution ended at a bare `"senpi"` when no executable was found, which is not a
 * runnable command: a senpi launched from an environment whose PATH lacks the senpi bin directory
 * produced children that died with `execvp() of 'senpi' failed: No such file or directory`, so
 * every background memory run failed while the parent session looked healthy.
 *
 * A PATH scan cannot be the last resort because the child inherits the same PATH that already
 * failed. The launcher retains any interpreter prefix needed by npm/Windows shims and falls back to
 * the CLI or entry script of the running Senpi installation.
 *
 * A compiled omo binary is its own engine and launches itself (`isCompiledEngine`): a PATH senpi is
 * a DIFFERENT install whose assets live in another layout, and it died on the inherited package
 * root before doing any work (`ENOENT .../dist/modes/interactive/theme/dark.json`).
 */
export function resolveSenpiLaunch(
  env: NodeJS.ProcessEnv,
  runtime: SenpiLaunchRuntime = defaultRuntime(),
): SenpiLauncher {
  const launcher = resolveTaskSenpiLauncher({
    isBunBinary: runtime.isBunBinary,
    isCompiledEngine: runtime.isCompiledEngine,
    execPath: runtime.execPath,
    platform: runtime.platform,
    parentEnv: env,
    resolveRpcEntry: () => "",
  })
  if (launcher !== null) return launcher
  const installedCli = runtime.resolveInstalledCli()
  if (installedCli !== null) return { command: runtime.execPath, prefixArgs: [installedCli] }
  const entry = runtime.argv[1]
  if (entry !== undefined && isAbsolute(entry) && existsSync(entry)) {
    return { command: runtime.execPath, prefixArgs: [entry] }
  }
  throw new Error("Unable to resolve a runnable Senpi launcher")
}

/**
 * Resolve the launch for a memory child, honoring an explicit host-supplied command.
 *
 * A host that resolves its own senpi command (the npm install shape: the node binary plus the
 * CLI entry in `senpiPrefixArgs`) must keep BOTH halves. Dropping the prefix leaves the bare
 * interpreter receiving senpi flags, which dies as `node: bad option: --fork`.
 */
export function resolveMemoryChildLaunch(input: {
  readonly senpiCommand?: string
  readonly senpiPrefixArgs?: readonly string[]
  readonly env: NodeJS.ProcessEnv
}): SenpiLauncher {
  if (input.senpiCommand === undefined) return resolveSenpiLaunch(input.env)
  return { command: input.senpiCommand, prefixArgs: input.senpiPrefixArgs ?? [] }
}

/**
 * Brand-scoped roots that senpi reads as its own package directory. The omo binary pins these to
 * its own runtime root for the engine it embeds (`remapSenpiEnvironment`).
 */
const PACKAGE_DIR_ENV_NAMES = ["OMO_PACKAGE_DIR", "SENPI_PACKAGE_DIR", "PI_PACKAGE_DIR"] as const

/**
 * The launcher arrives realpath-canonicalized (senpi-task `canonicalExecutable`) while the package
 * root is the raw directory the parent exported, so a symlinked home, agent dir, or `/var` vs
 * `/private/var` would make a containment test on raw strings disagree with itself. Canonicalize
 * both sides, falling back to the input when the path does not exist.
 */
function canonical(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    return path
  }
}

function isInside(root: string, target: string): boolean {
  const rel = relative(canonical(root), canonical(target))
  return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel)
}

/**
 * Drop package-dir variables that do not describe the senpi this child actually launches.
 *
 * A memory child inherits the parent's environment, and the omo binary exports its own runtime root
 * as `*_PACKAGE_DIR`. When the launcher resolves to a DIFFERENT senpi - the npm install found on
 * PATH - that child reads the inherited root as its own package directory and looks for shipped
 * assets under a tree that never contained them, dying before the run starts. Keeping the variables
 * only while the launcher lives inside the root they name preserves the intended override for the
 * embedded engine and for a relocated install.
 */
export function withoutForeignPackageDirEnv(
  env: NodeJS.ProcessEnv,
  launch: SenpiLauncher,
): NodeJS.ProcessEnv {
  const target = launch.prefixArgs[0] ?? launch.command
  const next = { ...env }
  for (const name of PACKAGE_DIR_ENV_NAMES) {
    const root = next[name]
    if (root === undefined || root.length === 0) continue
    if (!isInside(root, target)) delete next[name]
  }
  return next
}

export type SenpiLaunchRuntime = {
  readonly isBunBinary: boolean
  readonly isCompiledEngine: boolean
  readonly execPath: string
  readonly platform: NodeJS.Platform
  readonly argv: readonly string[]
  readonly resolveInstalledCli: () => string | null
}

function resolveInstalledSenpiCli(): string | null {
  const require = createRequire(import.meta.url)
  for (const modulesDir of require.resolve.paths(join(SENPI_PACKAGE_DIR, "package.json")) ?? []) {
    const candidate = join(modulesDir, SENPI_PACKAGE_DIR, CLI_RELATIVE)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function defaultRuntime(): SenpiLaunchRuntime {
  return {
    isBunBinary: detectBunBinary(import.meta.url),
    isCompiledEngine: detectCompiledEngine(),
    execPath: process.execPath,
    platform: process.platform,
    argv: process.argv,
    resolveInstalledCli: resolveInstalledSenpiCli,
  }
}
