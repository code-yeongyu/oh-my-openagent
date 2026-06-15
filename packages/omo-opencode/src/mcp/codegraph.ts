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

export function createCodegraphMcpConfig(options: CodegraphMcpConfigOptions = {}): LocalMcpConfig {
  const resolveExecutable = options.resolveExecutable ?? resolveRuntimeExecutable
  const resolvedCommand = resolveCodegraphCommand({
    env: options.env,
    fileExists: options.fileExists,
    homeDir: options.homeDir,
    nodeRuntime: createNodeRuntimeResolver(resolveExecutable),
    provisioned: options.provisioned,
    requireResolve: options.requireResolve,
    which: createWhichResolver(resolveExecutable),
  })

  return {
    type: "local",
    command: [resolvedCommand.command, ...resolvedCommand.argsPrefix, "serve", "--mcp"],
    enabled: resolvedCommand.exists,
    environment: buildCodegraphEnv({ homeDir: options.homeDir }),
  }
}
