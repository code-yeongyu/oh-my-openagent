import { readFileSync } from "fs"
import { resolve } from "path"
import { homedir } from "os"

function resolveFilePath(filePath: string, baseDir?: string): string {
  const trimmed = filePath.trim()
  if (trimmed.startsWith("~/")) {
    return resolve(homedir(), trimmed.slice(2))
  }
  return resolve(baseDir ?? process.cwd(), trimmed)
}

function readFileTemplate(filePath: string, baseDir?: string): string {
  const resolvedPath = resolveFilePath(filePath, baseDir)
  return readFileSync(resolvedPath, "utf-8").trim()
}

export function expandEnvVars(value: string, baseDir?: string): string {
  const fileMatches: Array<{ placeholder: string; filePath: string }> = []
  let counter = 0

  // Phase 1: Replace {file:...} with unique sentinels
  const withSentinels = value.replace(
    /\{file:([^}]+)\}/g,
    (_, filePath: string) => {
      const sentinel = `\x00FILE_TEMPLATE_${counter++}\x00`
      fileMatches.push({ placeholder: sentinel, filePath })
      return sentinel
    }
  )

  // Phase 2: Expand ${VAR} env vars (sentinels are untouched)
  const envExpanded = withSentinels.replace(
    /\$\{([^}:]+)(?::-([^}]*))?\}/g,
    (_, varName: string, defaultValue?: string) => {
      const envValue = process.env[varName]
      if (envValue !== undefined) return envValue
      if (defaultValue !== undefined) return defaultValue
      return ""
    }
  )

  // Phase 3: Replace sentinels with actual file content (never re-expanded)
  let result = envExpanded
  for (const { placeholder, filePath } of fileMatches) {
    const content = readFileTemplate(filePath, baseDir)
    result = result.replace(placeholder, () => content)
  }

  return result
}

export function expandEnvVarsInObject<T>(obj: T, baseDir?: string): T {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === "string") return expandEnvVars(obj, baseDir) as T
  if (Array.isArray(obj)) {
    return obj.map((item) => expandEnvVarsInObject(item, baseDir)) as T
  }
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = expandEnvVarsInObject(value, baseDir)
    }
    return result as T
  }
  return obj
}
