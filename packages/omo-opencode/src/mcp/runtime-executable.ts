import { basename } from "node:path"
import { bunWhich } from "../shared/bun-which-shim"

export type RuntimeExecutable = {
  readonly command: string
  readonly available: boolean
}

export type RuntimeExecutableResolver = (commandName: string) => RuntimeExecutable

type RuntimeExecutableOptions = {
  readonly which?: (commandName: string) => string | null
  readonly execPath?: string
}

const NODE_EXECUTABLE_NAMES = new Set(["node", "node.exe"])

// Local fix 47: the built-in MCP configs resolve the same executables for every new chat folder; a PATH
// search is synchronous file-system work on the shared event loop. Remember default lookups per PATH value.
const defaultLookups = new Map<string, string | null>()

function cachedBunWhich(commandName: string): string | null {
  const key = `${process.env.PATH ?? process.env.Path ?? ""}\0${commandName}`
  if (defaultLookups.has(key)) return defaultLookups.get(key) ?? null
  const resolved = bunWhich(commandName)
  defaultLookups.set(key, resolved)
  return resolved
}

function isUnsafeCommandName(commandName: string): boolean {
  if (commandName.length === 0) return true
  if (commandName.includes("/") || commandName.includes("\\")) return true
  if (commandName === "." || commandName === ".." || commandName.includes("..")) return true
  if (/^[a-zA-Z]:/.test(commandName)) return true
  if (commandName.includes("\0")) return true

  return false
}

function isNodeExecPath(execPath: string): boolean {
  return NODE_EXECUTABLE_NAMES.has(basename(execPath).toLowerCase())
}

export function resolveRuntimeExecutable(commandName: string, options: RuntimeExecutableOptions = {}): RuntimeExecutable {
  if (isUnsafeCommandName(commandName)) {
    return { command: commandName, available: false }
  }

  const execPath = options.execPath ?? process.execPath
  if (commandName === "node" && isNodeExecPath(execPath)) {
    return { command: execPath, available: true }
  }

  const resolved = (options.which ?? cachedBunWhich)(commandName)
  if (resolved) {
    return { command: resolved, available: true }
  }

  return { command: commandName, available: false }
}
