import { existsSync } from "node:fs"
import { join } from "node:path"
import { buildCodegraphEnv, resolveCodegraphCommand } from "@oh-my-opencode/utils"
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

function createNodeRuntimeResolver(resolveExecutable: RuntimeExecutableResolver): () => string | null {
  return (): string | null => {
    const resolved = resolveExecutable("node")
    return resolved.available ? resolved.command : null
  }
}

function provisionedBinFromInstallDir(
  installDir: string | undefined,
  fileExists: (filePath: string) => boolean,
): string | null {
  if (installDir === undefined) return null
  const candidate = join(installDir, "bin", process.platform === "win32" ? "codegraph.exe" : "codegraph")
  return fileExists(candidate) ? candidate : null
}

function codegraphEnvForConfig(config: Partial<CodegraphConfig> | undefined, homeDir: string | undefined): Record<string, string> {
  const env = buildCodegraphEnv({ homeDir })
  return config?.install_dir === undefined ? env : { ...env, CODEGRAPH_INSTALL_DIR: config.install_dir }
}

export function createCodegraphMcpConfig(options: CodegraphMcpConfigOptions = {}): LocalMcpConfig {
  const resolveExecutable = options.resolveExecutable ?? resolveRuntimeExecutable
  const fileExists = options.fileExists ?? existsSync
  const resolvedCommand = resolveCodegraphCommand({
    env: options.env,
    fileExists,
    homeDir: options.homeDir,
    nodeRuntime: createNodeRuntimeResolver(resolveExecutable),
    provisioned: options.provisioned ?? (() => provisionedBinFromInstallDir(options.config?.install_dir, fileExists)),
    requireResolve: options.requireResolve,
    which: createWhichResolver(resolveExecutable),
  })

  return {
    type: "local",
    command: [resolvedCommand.command, ...resolvedCommand.argsPrefix, "serve", "--mcp"],
    enabled: resolvedCommand.exists,
    environment: codegraphEnvForConfig(options.config, options.homeDir),
  }
}
