import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { buildCodegraphEnv, resolveCodegraphCommand, resolveCodegraphNodeSupport } from "@oh-my-opencode/utils"
import type { ResolveCodegraphCommandOptions } from "@oh-my-opencode/utils"
import type { CodegraphConfig } from "../config/schema/codegraph"
import type { LocalMcpConfig } from "./lsp"
import { resolveRuntimeExecutable, type RuntimeExecutableResolver } from "./runtime-executable"
import { hasCliSuffix } from "./cli-suffix"
import { createAncestorCliCandidates, type AncestorCliCandidate } from "./shared/ancestor-cli-resolver"

const PACKAGE_REL = "packages/codegraph-mcp"
const DIST_CLI_REL = "dist/cli.js"
const SOURCE_CLI_REL = "src/cli.ts"

export type CodegraphMcpConfigOptions = {
  readonly config?: Partial<CodegraphConfig>
  readonly cwd?: string
  readonly env?: ResolveCodegraphCommandOptions["env"]
  readonly fileExists?: ResolveCodegraphCommandOptions["fileExists"]
  readonly homeDir?: string
  readonly moduleUrl?: string
  readonly nodeVersionForExecutable?: ResolveCodegraphCommandOptions["nodeVersion"]
  readonly provisioned?: ResolveCodegraphCommandOptions["provisioned"]
  readonly requireResolve?: ResolveCodegraphCommandOptions["requireResolve"]
  readonly resolveExecutable?: RuntimeExecutableResolver
  readonly proxy?: Pick<AncestorCliCandidate, "command" | "exists">
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
  const env = buildCodegraphEnv({ homeDir })
  return {
    ...env,
    ...(config?.install_dir === undefined ? {} : { CODEGRAPH_INSTALL_DIR: config.install_dir }),
    OMO_CODEGRAPH_AUTO_INIT: config?.auto_init === false ? "0" : "1",
  }
}

function resolveProxyCommand(options: CodegraphMcpConfigOptions): Pick<AncestorCliCandidate, "command" | "exists"> {
  if (options.proxy !== undefined) return options.proxy
  const pathExists = options.fileExists ?? existsSync
  const resolveExecutable = options.resolveExecutable ?? resolveRuntimeExecutable
  let moduleDirectory: string
  try {
    moduleDirectory = dirname(fileURLToPath(options.moduleUrl ?? import.meta.url))
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return { command: ["node", "codegraph-mcp"], exists: false }
  }
  const candidates = createAncestorCliCandidates({
    startDirectory: moduleDirectory,
    packageRel: PACKAGE_REL,
    distCliRel: DIST_CLI_REL,
    sourceCliRel: SOURCE_CLI_REL,
    pathExists,
    resolveExecutable,
  })
  return (
    candidates.find((candidate) => hasCliSuffix(candidate.path, DIST_CLI_REL) && candidate.exists) ??
    candidates.find((candidate) => hasCliSuffix(candidate.path, SOURCE_CLI_REL) && candidate.exists) ??
    { command: ["node", "codegraph-mcp"], exists: false }
  )
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
    resolvedCommand.exists &&
    (resolvedCommand.source === "bundled" ||
      resolvedCommand.source === "env" ||
      resolvedCommand.source === "provisioned" ||
      nodeSupport.supported)
  const proxy = resolveProxyCommand(options)
  const canProxyProvision = resolvedCommand.source !== "env" && options.config?.auto_provision !== false

  return {
    type: "local",
    command: proxy.command,
    enabled: proxy.exists && (enabled || canProxyProvision),
    environment: codegraphEnvForConfig(options.config, options.homeDir),
  }
}
