import { isPlainRecord } from "./codex-cache-fs"
import { cp, mkdir, readFile, stat } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

interface BundledMcpRuntime {
  readonly label: string
  readonly sourceArg: string
  readonly sourceDistFromPlugin: string
  readonly destinationArg: string
  readonly destinationDistFromPlugin: string
}

const BUNDLED_MCP_RUNTIMES = [
  {
    label: "ast-grep MCP",
    sourceArg: "../../ast-grep-mcp/dist/cli.js",
    sourceDistFromPlugin: "../../ast-grep-mcp/dist",
    destinationArg: "./components/ast-grep-mcp/dist/cli.js",
    destinationDistFromPlugin: "components/ast-grep-mcp/dist",
  },
  {
    label: "Git Bash MCP",
    sourceArg: "../../git-bash-mcp/dist/cli.js",
    sourceDistFromPlugin: "../../git-bash-mcp/dist",
    destinationArg: "./components/git-bash-mcp/dist/cli.js",
    destinationDistFromPlugin: "components/git-bash-mcp/dist",
  },
  {
    label: "LSP daemon",
    sourceArg: "../../lsp-daemon/dist/cli.js",
    sourceDistFromPlugin: "../../lsp-daemon/dist",
    destinationArg: "./components/lsp-daemon/dist/cli.js",
    destinationDistFromPlugin: "components/lsp-daemon/dist",
  },
] as const satisfies readonly BundledMcpRuntime[]

export async function copyBundledMcpRuntimeDists(input: {
  readonly pluginRoot: string
  readonly sourceRoot: string
}): Promise<void> {
  const sourceArgs = await readSourceMcpArgs(join(input.sourceRoot, ".mcp.json"))
  for (const runtime of BUNDLED_MCP_RUNTIMES) {
    if (!sourceArgs.has(runtime.sourceArg)) continue
    await copyBundledMcpRuntimeDist(input.pluginRoot, input.sourceRoot, runtime)
  }
}

export function resolveBundledMcpRuntimeArg(pluginRoot: string, arg: string): string | null {
  const runtime = BUNDLED_MCP_RUNTIMES.find((candidate) => candidate.sourceArg === arg)
  return runtime ? join(pluginRoot, runtime.destinationArg) : null
}

async function copyBundledMcpRuntimeDist(
  pluginRoot: string,
  sourceRoot: string,
  runtime: BundledMcpRuntime,
): Promise<void> {
  const sourcePath = resolve(sourceRoot, runtime.sourceDistFromPlugin)
  if (!(await isDirectory(sourcePath))) {
    throw new Error(`missing built ${runtime.label} dist at ${sourcePath}`)
  }
  const destinationPath = join(pluginRoot, runtime.destinationDistFromPlugin)
  await mkdir(dirname(destinationPath), { recursive: true })
  await cp(sourcePath, destinationPath, { recursive: true })
}

async function readSourceMcpArgs(path: string): Promise<ReadonlySet<string>> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, "utf8"))
  } catch (error) {
    if (error instanceof Error) return new Set()
    return new Set()
  }

  const args = new Set<string>()
  if (!isPlainRecord(parsed) || !isPlainRecord(parsed.mcpServers)) return args
  for (const server of Object.values(parsed.mcpServers)) {
    if (!isPlainRecord(server) || !Array.isArray(server.args)) continue
    for (const arg of server.args) {
      if (typeof arg === "string") args.add(arg)
    }
  }
  return args
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch (error) {
    if (error instanceof Error) return false
    return false
  }
}
