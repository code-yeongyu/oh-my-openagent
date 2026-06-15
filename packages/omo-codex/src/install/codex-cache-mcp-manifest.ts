import { readFile, writeFile } from "node:fs/promises"
import { join, sep } from "node:path"
import { resolveBundledMcpRuntimeArg } from "./codex-cache-bundled-mcps"
import { fileExistsStrict, isPlainRecord } from "./codex-cache-fs"
import { resolveCachedRuntimePath } from "./codex-cache-paths"

export async function rewriteCachedMcpManifest(pluginRoot: string, sourceRoot = pluginRoot): Promise<void> {
  const manifestPath = join(pluginRoot, ".mcp.json")
  if (!(await fileExistsStrict(manifestPath))) return
  const raw = await readFile(manifestPath, "utf8")
  const parsed: unknown = JSON.parse(raw)
  if (!isPlainRecord(parsed) || !isPlainRecord(parsed.mcpServers)) return
  let changed = false
  for (const server of Object.values(parsed.mcpServers)) {
    if (!isPlainRecord(server)) continue
    if (server.cwd === "." || server.cwd === "./") {
      delete server.cwd
      changed = true
    }
    const currentArgs = server.args
    if (!Array.isArray(currentArgs)) continue
    const nextArgs = currentArgs.map((arg) => {
      if (typeof arg !== "string") return arg
      const bundledMcpRuntimeArg = resolveBundledMcpRuntimeArg(pluginRoot, arg)
      if (bundledMcpRuntimeArg !== null) return bundledMcpRuntimeArg
      if (arg.startsWith("./") || arg.startsWith("../")) return resolveCachedRuntimePath(pluginRoot, sourceRoot, arg)
      return arg
    })
    if (nextArgs.some((value, index) => value !== currentArgs[index])) {
      server.args = nextArgs
      changed = true
    }
  }
  if (changed) await writeFile(manifestPath, `${JSON.stringify(parsed, null, "\t")}\n`)
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
