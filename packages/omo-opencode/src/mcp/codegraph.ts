import { existsSync } from "node:fs"
import { join } from "node:path"
import { buildCodegraphEnv, resolveCodegraphCommand, resolveCodegraphNodeSupport, shouldExcludeCodegraphProject } from "@oh-my-opencode/utils"
import type { ResolveCodegraphCommandOptions } from "@oh-my-opencode/utils"
import type { CodegraphConfig } from "../config/schema/codegraph"
import type { LocalMcpConfig } from "./lsp"
import { resolveRuntimeExecutable, type RuntimeExecutableResolver } from "./runtime-executable"

export type CodegraphMcpConfigOptions = {
  readonly config?: Partial<CodegraphConfig>
  readonly cwd?: string
  readonly env?: ResolveCodegraphCommandOptions["env"]
  readonly fileExists?: ResolveCodegraphCommandOptions["fileExists"]
  readonly homeDir?: string
  readonly nodeVersionForExecutable?: ResolveCodegraphCommandOptions["nodeVersion"]
  readonly provisioned?: ResolveCodegraphCommandOptions["provisioned"]
  readonly requireResolve?: ResolveCodegraphCommandOptions["requireResolve"]
  readonly resolveExecutable?: RuntimeExecutableResolver
}

function createWhichResolver(resolveExecutable: RuntimeExecutableResolver): (commandName: string) => string | null {
  return (commandName: string): string | null => {
    const resolved = resolveExecutable(commandName)
    return resolved.available ? resolved.command : null
  }
}

function provisionedBinFromInstallDir(
  installDir: string | undefined,
  fileExists: (filePath: string) => boolean,
): string | null {
  if (installDir === undefined) return null
  const candidate = join(installDir, "bin", process.platform === "win32" ? "codegraph.cmd" : "codegraph")
  return fileExists(candidate) ? candidate : null
}

function codegraphEnvForConfig(config: Partial<CodegraphConfig> | undefined, homeDir: string | undefined): Record<string, string> {
  const env = buildCodegraphEnv({ homeDir, daemon: config?.daemon === true })
  return config?.install_dir === undefined ? env : { ...env, CODEGRAPH_INSTALL_DIR: config.install_dir }
}

function isProjectExcluded(config: Partial<CodegraphConfig> | undefined, options: CodegraphMcpConfigOptions): boolean {
  if (options.cwd === undefined) return false
  const excludedRoots = config?.excluded_roots
  return shouldExcludeCodegraphProject(options.cwd, {
    homeDir: options.homeDir,
    ...(excludedRoots === undefined ? {} : { excludedRoots }),
  }).excluded
}

export function createCodegraphMcpConfig(options: CodegraphMcpConfigOptions = {}): LocalMcpConfig {
  const env = options.env ?? process.env
  const resolveExecutable = options.resolveExecutable ?? resolveRuntimeExecutable
  const which = createWhichResolver(resolveExecutable)
  const fileExists = options.fileExists ?? existsSync
  const resolvedCommand = resolveCodegraphCommand({
    env,
    fileExists,
    homeDir: options.homeDir,
    nodeVersion: options.nodeVersionForExecutable,
    provisioned: options.provisioned ?? (() => provisionedBinFromInstallDir(options.config?.install_dir, fileExists)),
    requireResolve: options.requireResolve,
    which,
  })
  const nodeSupport = resolveCodegraphNodeSupport({
    env,
    fileExists,
    nodeVersion: options.nodeVersionForExecutable,
    which,
  })
  const enabled =
    !isProjectExcluded(options.config, options)
    && resolvedCommand.exists
    && (resolvedCommand.source === "bundled" || resolvedCommand.source === "env" || nodeSupport.supported)

  return {
    type: "local",
    command: [resolvedCommand.command, ...resolvedCommand.argsPrefix, "serve", "--mcp"],
    enabled,
    environment: codegraphEnvForConfig(options.config, options.homeDir),
  }
}
