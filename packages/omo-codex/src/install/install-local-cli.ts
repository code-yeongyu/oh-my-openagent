import { readFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { defaultRunCommand } from "./codex-process"
import { resolveCodexInstallerBinDir } from "./codex-installer-bin-dir"
import { runCodexInstaller } from "./install-codex"
import { formatLazyCodexInstallHelp, parseLazyCodexInstallCliArgs } from "./lazycodex-cli-args"
import { runDelegatedOmoCommand } from "./lazycodex-delegated-command"
import { runLazyCodexManualUpdate } from "./lazycodex-manual-update"
import type { CodexInstallOptions, CodexInstallResult } from "./types"

export { resolveCodexInstallerBinDir } from "./codex-installer-bin-dir"
export { installCachedPlugin, linkCachedPluginBins, linkRootRuntimeBin } from "./codex-cache"
export { updateCodexConfig } from "./codex-config-toml"
export { readCodexModelCatalog } from "./codex-model-catalog"
export { stampGitBashMcpEnv } from "./codex-git-bash-mcp-env"
export { assertHookCommandTargets, findMissingHookCommandTargets } from "./codex-hook-targets"
export { repairNearestProjectLocalCodexArtifacts } from "./codex-project-local-cleanup"
export { PASSTHROUGH_COMMANDS, formatLazyCodexInstallHelp, parseLazyCodexInstallCliArgs } from "./lazycodex-cli-args"
export { buildDelegatedOmoInvocation, runDelegatedOmoCommand } from "./lazycodex-delegated-command"

export async function installMarketplaceLocally(options: CodexInstallOptions = {}): Promise<CodexInstallResult> {
  return runCodexInstaller(options)
}

export function resolveDefaultRepoRootForEntrypoint(entrypointPath: string): string {
  return resolve(dirname(entrypointPath), "..", "..", "..")
}

export function resolveDefaultRepoRoot(): string {
  return resolveDefaultRepoRootForEntrypoint(fileURLToPath(import.meta.url))
}

export async function runLazyCodexInstallLocalCli(input: {
  readonly argv: readonly string[]
  readonly defaultRepoRoot: string
  readonly entrypointPath: string
  readonly invokedPath?: string
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  readonly log: (line: string) => void
}): Promise<number> {
  const logWarning = (message: string): void => {
    if (message.startsWith("Warning:")) input.log(message)
  }
  const parsed = parseLazyCodexInstallCliArgs(input.argv)
  if (parsed.kind === "help") {
    input.log(formatLazyCodexInstallHelp())
    return 0
  }
  if (parsed.kind === "version") {
    const packageJson = JSON.parse(await readFile(join(input.defaultRepoRoot, "package.json"), "utf8")) as { readonly version?: unknown }
    const version = typeof packageJson.version === "string" ? packageJson.version : "unknown"
    input.log(`lazycodex-ai ${version}`)
    return 0
  }
  if (parsed.kind === "command") {
    await runDelegatedOmoCommand(parsed, { cwd: input.cwd, log: input.log, runCommand: defaultRunCommand })
    return 0
  }
  if (parsed.kind === "update") {
    if (parsed.repoRoot) {
      if (parsed.dryRun) {
        input.log(`node ${input.entrypointPath} install --repo-root=${parsed.repoRoot}`)
        return 0
      }
      const result = await installMarketplaceLocally({
        repoRoot: resolve(parsed.repoRoot),
        autonomousPermissions: true,
        env: input.env,
        log: logWarning,
      })
      input.log(`Installed ${result.installed.length} plugin(s) from ${result.marketplaceName}.`)
      return 0
    }
    return runLazyCodexManualUpdate({ env: input.env, dryRun: parsed.dryRun, log: input.log, invokedPath: input.invokedPath })
  }

  const repoRoot = parsed.repoRoot ? resolve(parsed.repoRoot) : input.defaultRepoRoot
  const result = await installMarketplaceLocally({
    repoRoot,
    autonomousPermissions: parsed.autonomousPermissions,
    env: input.env,
    log: logWarning,
  })
  input.log(`Installed ${result.installed.length} plugin(s) from ${result.marketplaceName}.`)
  return 0
}
