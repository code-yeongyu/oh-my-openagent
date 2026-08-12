import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { isAbsolute, join } from "node:path"

import {
  detectBunBinary,
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
 */
export function resolveSenpiLaunch(
  env: NodeJS.ProcessEnv,
  runtime: SenpiLaunchRuntime = defaultRuntime(),
): SenpiLauncher {
  const launcher = resolveTaskSenpiLauncher({
    isBunBinary: runtime.isBunBinary,
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

export type SenpiLaunchRuntime = {
  readonly isBunBinary: boolean
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
    execPath: process.execPath,
    platform: process.platform,
    argv: process.argv,
    resolveInstalledCli: resolveInstalledSenpiCli,
  }
}
