import { readFile, writeFile } from "node:fs/promises"
import { join, sep } from "node:path"
import { resolveCodegraphNodeRuntime } from "@oh-my-opencode/utils/codegraph/resolve"
import { resolveBundledMcpRuntimeArg } from "./codex-cache-bundled-mcps"
import { fileExistsStrict, isPlainRecord } from "./codex-cache-fs"
import { resolveCachedRuntimePath } from "./codex-cache-paths"

const CODEGRAPH_RELATIVE_ARGS = new Set(["components/codegraph/dist/serve.js", "./components/codegraph/dist/serve.js"])
const CONTEXT7_API_KEY_ENV = "CONTEXT7_API_KEY"

export interface RewriteCachedMcpManifestOptions {
  readonly codegraphNodeRuntime?: () => string | null
}

export async function rewriteCachedMcpManifest(
  pluginRoot: string,
  sourceRoot = pluginRoot,
  options: RewriteCachedMcpManifestOptions = {},
): Promise<void> {
  const manifestPath = join(pluginRoot, ".mcp.json")
  if (!(await fileExistsStrict(manifestPath))) return
  const raw = await readFile(manifestPath, "utf8")
  const parsed: unknown = JSON.parse(raw)
  if (!isPlainRecord(parsed) || !isPlainRecord(parsed.mcpServers)) return
  let changed = false
  for (const [serverName, server] of Object.entries(parsed.mcpServers)) {
    if (!isPlainRecord(server)) continue
    if (server.cwd === "." || server.cwd === "./") {
      delete server.cwd
      changed = true
    }
    const currentArgs = server.args
    if (Array.isArray(currentArgs)) {
      const nextArgs = currentArgs.map((arg) => {
        if (typeof arg !== "string") return arg
        const bundledMcpRuntimeArg = resolveBundledMcpRuntimeArg(pluginRoot, arg)
        if (bundledMcpRuntimeArg !== null) return bundledMcpRuntimeArg
        if (CODEGRAPH_RELATIVE_ARGS.has(arg)) return join(pluginRoot, "components", "codegraph", "dist", "serve.js")
        if (arg.startsWith("./") || arg.startsWith("../")) return resolveCachedRuntimePath(pluginRoot, sourceRoot, arg)
        return arg
      })
      if (nextArgs.some((value, index) => value !== currentArgs[index])) {
        server.args = nextArgs
        changed = true
      }
    }
    if (serverName === "context7" && sanitizeContext7Auth(server)) {
      changed = true
    }
    if (!Array.isArray(currentArgs)) continue
    if (server === parsed.mcpServers.codegraph) {
      const runtime = options.codegraphNodeRuntime?.() ?? resolveCodegraphNodeRuntime()
      if (runtime !== null && server.command === "node") {
        server.command = runtime
        changed = true
      }
    }
  }
  if (changed) await writeFile(manifestPath, `${JSON.stringify(parsed, null, "\t")}\n`)
}

function sanitizeContext7Auth(server: Record<string, unknown>): boolean {
  let changed = false
  const currentArgs = server.args
  if (Array.isArray(currentArgs)) {
    const nextArgs = removeContext7ApiKeyArgs(currentArgs)
    if (nextArgs.some((value, index) => value !== currentArgs[index]) || nextArgs.length !== currentArgs.length) {
      server.args = nextArgs
      changed = true
    }
  }

  const beforeEnv = JSON.stringify(server.env)
  const nextEnv = sanitizeContext7Env(server.env)
  if (Object.keys(nextEnv).length > 0) {
    server.env = nextEnv
  } else {
    delete server.env
  }
  return changed || JSON.stringify(server.env) !== beforeEnv
}

function removeContext7ApiKeyArgs(args: readonly unknown[]): unknown[] {
  const nextArgs: unknown[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const value = args[index + 1]
    if (
      typeof arg === "string" &&
      isContext7ApiKeyFlag(arg) &&
      (isPlaceholderContext7ApiKey(value) || value === undefined)
    ) {
      index += 1
      continue
    }
    nextArgs.push(arg)
  }
  return nextArgs
}

function sanitizeContext7Env(value: unknown): Record<string, unknown> {
  const nextEnv: Record<string, unknown> = {}
  if (isPlainRecord(value)) {
    for (const [key, envValue] of Object.entries(value)) {
      if (key === CONTEXT7_API_KEY_ENV && isPlaceholderContext7ApiKey(envValue)) continue
      nextEnv[key] = envValue
    }
  }
  return nextEnv
}

function isContext7ApiKeyFlag(value: string): boolean {
  return value === "--api-key" || value === "--apiKey"
}

function isPlaceholderContext7ApiKey(value: unknown): boolean {
  if (typeof value !== "string") return false
  const normalized = value.trim().toLowerCase().replace(/[<>"'`]/g, "").replace(/[\s_-]+/g, " ")
  return normalized.length === 0 || normalized === "your api key"
}

export async function rewriteCachedManifestRoot(pluginRoot: string, fromRoot: string, toRoot: string): Promise<void> {
  const manifestPath = join(pluginRoot, ".mcp.json")
  if (!(await fileExistsStrict(manifestPath))) return
  const raw = await readFile(manifestPath, "utf8")
  const parsed: unknown = JSON.parse(raw)
  if (!isPlainRecord(parsed) || !isPlainRecord(parsed.mcpServers)) return
  let changed = false
  for (const server of Object.values(parsed.mcpServers)) {
    if (!isPlainRecord(server)) continue
    const currentArgs = server.args
    if (!Array.isArray(currentArgs)) continue
    const nextArgs = currentArgs.map((arg) => {
      if (typeof arg !== "string") return arg
      if (arg === fromRoot) return toRoot
      const prefix = `${fromRoot}${sep}`
      if (!arg.startsWith(prefix)) return arg
      return `${toRoot}${arg.slice(fromRoot.length)}`
    })
    if (nextArgs.some((value, index) => value !== currentArgs[index])) {
      server.args = nextArgs
      changed = true
    }
  }
  if (changed) await writeFile(manifestPath, `${JSON.stringify(parsed, null, "\t")}\n`)
}
