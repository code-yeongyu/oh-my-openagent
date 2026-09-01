import { readFile } from "node:fs/promises"
import { join, sep } from "node:path"
import { fileExistsStrict, isPlainRecord } from "./codex-cache-fs"

const PLUGIN_ROOT_TARGET_PATTERN = /\$\{PLUGIN_ROOT\}[\\/]+([^"']+)/g

export async function findMissingHookCommandTargets(pluginRoot: string): Promise<readonly string[]> {
  const commands: string[] = []
  for (const manifestPath of await hookManifestPaths(pluginRoot)) {
    if (!(await fileExistsStrict(manifestPath))) continue
    const parsed: unknown = JSON.parse(await readFile(manifestPath, "utf8"))
    collectCommands(parsed, commands)
  }

  const missing: string[] = []
  const seen = new Set<string>()
  for (const command of commands) {
    for (const match of command.matchAll(PLUGIN_ROOT_TARGET_PATTERN)) {
      const targetSuffix = match[1]
      if (targetSuffix === undefined) continue
      const target = join(pluginRoot, ...targetSuffix.split(/[\\/]+/))
      if (seen.has(target)) continue
      seen.add(target)
      if (!(await fileExistsStrict(target))) missing.push(target)
    }
  }
  return missing
}

async function hookManifestPaths(pluginRoot: string): Promise<readonly string[]> {
  const pluginManifestPath = join(pluginRoot, ".codex-plugin", "plugin.json")
  if (!(await fileExistsStrict(pluginManifestPath))) return [join(pluginRoot, "hooks", "hooks.json")]
  const parsed: unknown = JSON.parse(await readFile(pluginManifestPath, "utf8"))
  if (!isPlainRecord(parsed)) return []
  if (typeof parsed.hooks === "string" && parsed.hooks.trim() !== "") {
    return [join(pluginRoot, stripDotSlash(parsed.hooks))]
  }
  if (Array.isArray(parsed.hooks)) {
    return parsed.hooks
      .filter((hookPath) => typeof hookPath === "string" && hookPath.trim() !== "")
      .map((hookPath) => join(pluginRoot, stripDotSlash(hookPath)))
  }
  return []
}

function stripDotSlash(path: string): string {
  return path.startsWith("./") ? path.slice(2) : path
}

export async function assertHookCommandTargets(pluginRoot: string): Promise<void> {
  const missing = await findMissingHookCommandTargets(pluginRoot)
  if (missing.length === 0) return
  const relativeMissing = missing.map((path) => path.split(`${pluginRoot}${sep}`).join("").split(sep).join("/"))
  throw new Error(
    `Plugin payload is missing ${missing.length} hook command target(s) referenced by hooks.json: ${relativeMissing.join(", ")}. ` +
      "The previous plugin cache was left untouched; this payload was not activated.",
  )
}

function collectCommands(value: unknown, commands: string[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectCommands(entry, commands)
    return
  }
  if (!isPlainRecord(value)) return
  if (value["type"] === "command" && typeof value["command"] === "string") commands.push(value["command"])
  if (value["type"] === "command" && typeof value["commandWindows"] === "string") commands.push(value["commandWindows"])
  for (const entry of Object.values(value)) collectCommands(entry, commands)
}
