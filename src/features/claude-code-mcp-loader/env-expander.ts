import { readFileSync } from "fs"
import { resolve } from "path"

export function expandFileTemplates(value: string): string {
  return value.replace(
    /\{file:([^}]+)\}/g,
    (match, filePath: string) => {
      try {
        const resolvedPath = resolve(process.cwd(), filePath.trim())
        return readFileSync(resolvedPath, "utf-8").trim()
      } catch {
        return match // Return original if file not found
      }
    }
  )
}

export function expandEnvVars(value: string): string {
  const fileExpanded = expandFileTemplates(value)
  return fileExpanded.replace(
    /\$\{([^}:]+)(?::-([^}]*))?\}/g,
    (_, varName: string, defaultValue?: string) => {
      const envValue = process.env[varName]
      if (envValue !== undefined) return envValue
      if (defaultValue !== undefined) return defaultValue
      return ""
    }
  )
}

export function expandEnvVarsInObject<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === "string") return expandEnvVars(obj) as T
  if (Array.isArray(obj)) {
    return obj.map((item) => expandEnvVarsInObject(item)) as T
  }
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = expandEnvVarsInObject(value)
    }
    return result as T
  }
  return obj
}
