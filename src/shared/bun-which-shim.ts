import { accessSync, constants } from "node:fs"
import { delimiter, join } from "node:path"

type BunWhichRuntime = { which(commandName: string): string | null }
const runtime = globalThis as typeof globalThis & { Bun?: BunWhichRuntime }
const IS_BUN = typeof runtime.Bun !== "undefined"

function isUnsafeCommandName(commandName: string): boolean {
  if (commandName.includes("/") || commandName.includes("\\")) return true
  if (commandName === "." || commandName === ".." || commandName.includes("..")) return true
  if (/^[a-zA-Z]:/.test(commandName)) return true
  if (commandName.includes("\0")) return true

  return false
}

function isExecutable(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function resolvePathValue(): string | undefined {
  if (process.platform === "win32") return process.env.Path ?? process.env.PATH

  return process.env.PATH
}

function getWindowsCandidates(commandName: string): string[] {
  if (process.platform !== "win32") return [commandName]

  return [commandName, `${commandName}.exe`, `${commandName}.cmd`, `${commandName}.bat`, `${commandName}.com`]
}

export function bunWhich(commandName: string): string | null {
  if (!commandName) return null
  if (isUnsafeCommandName(commandName)) return null
  if (IS_BUN) return runtime.Bun?.which(commandName) ?? null

  const pathValue = resolvePathValue()
  if (!pathValue) return null

  const pathEntries = pathValue.split(delimiter).filter((pathEntry) => pathEntry.length > 0)
  if (pathEntries.length === 0) return null

  const candidateNames = getWindowsCandidates(commandName)
  for (const pathEntry of pathEntries) {
    for (const candidateName of candidateNames) {
      const candidatePath = join(pathEntry, candidateName)
      if (isExecutable(candidatePath)) return candidatePath
    }
  }

  return null
}
