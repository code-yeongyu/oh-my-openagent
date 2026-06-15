import { accessSync, constants } from "node:fs"
import { delimiter, join } from "node:path"

type BunWhichRuntime = { which(commandName: string): string | null }

const runtime = globalThis as typeof globalThis & { readonly Bun?: BunWhichRuntime }

function isUnsafeCommandName(commandName: string): boolean {
  if (commandName.includes("/") || commandName.includes("\\")) return true
  if (commandName === "." || commandName === ".." || commandName.includes("..")) return true
  if (/^[a-zA-Z]:/.test(commandName)) return true
  if (commandName.includes("\0")) return true

  return false
}

function isExecutable(filePath: string): boolean {
  try {
    accessSync(filePath, process.platform === "win32" ? constants.F_OK : constants.X_OK)
    return true
  } catch (error) {
    if (!(error instanceof Error) && Object.prototype.toString.call(error) !== "[object Error]") {
      throw error
    }

    return false
  }
}

function resolvePathValue(): string | undefined {
  if (process.platform === "win32") return process.env.Path ?? process.env.PATH

  return process.env.PATH
}

function getWindowsCandidates(commandName: string): string[] {
  if (process.platform !== "win32") return [commandName]
  if (/\.[^\\/]+$/.test(commandName)) return [commandName]

  return [commandName, `${commandName}.exe`, `${commandName}.cmd`, `${commandName}.bat`, `${commandName}.com`]
}

export function bunWhich(commandName: string): string | null {
  if (!commandName) return null
  if (isUnsafeCommandName(commandName)) return null

  const candidateNames = getWindowsCandidates(commandName)
  for (const candidateName of candidateNames) {
    const resolvedPath = runtime.Bun?.which(candidateName) ?? null
    if (resolvedPath !== null) return resolvedPath
  }

  const pathValue = resolvePathValue()
  if (!pathValue) return null

  const pathEntries = pathValue.split(delimiter).filter((pathEntry) => pathEntry.length > 0)
  if (pathEntries.length === 0) return null

  for (const pathEntry of pathEntries) {
    for (const candidateName of candidateNames) {
      const candidatePath = join(pathEntry, candidateName)
      if (isExecutable(candidatePath)) return candidatePath
    }
  }

  return null
}
