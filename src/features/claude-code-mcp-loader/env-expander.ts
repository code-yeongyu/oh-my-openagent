import { log } from "../../shared/logger"
import {
  isAllowedMcpEnvVar,
  isSensitiveMcpEnvVar,
} from "./configure-allowed-env-vars"

export interface ExpandEnvVarsOptions {
  trusted?: boolean
}

export function expandEnvVars(value: string, options: ExpandEnvVarsOptions = {}): string {
  const { trusted = false } = options
  return value.replace(
    /\$\{([^}:]+)(?::-([^}]*))?\}/g,
    (_, varName: string, defaultValue?: string) => {
      if (!trusted && !isAllowedMcpEnvVar(varName)) {
        const isSensitive = isSensitiveMcpEnvVar(varName)
        const reason = isSensitive ? "sensitive variable" : "not in allowlist"

        log(`Blocked MCP env var expansion for ${reason} "${varName}"`, {
          varName,
          sensitive: isSensitive,
        })

        if (defaultValue !== undefined) return defaultValue
        return ""
      }

      const envValue = process.env[varName]
      if (envValue !== undefined) return envValue
      if (defaultValue !== undefined) return defaultValue
      return ""
    }
  )
}

export function expandEnvVarsInObject<T>(obj: T, options: ExpandEnvVarsOptions = {}): T {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === "string") return expandEnvVars(obj, options) as T
  if (Array.isArray(obj)) {
    return obj.map((item) => expandEnvVarsInObject(item, options)) as T
  }
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = expandEnvVarsInObject(value, options)
    }
    return result as T
  }
  return obj
}
