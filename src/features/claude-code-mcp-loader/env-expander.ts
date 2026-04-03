import { log } from "../../shared/logger"
import {
  isAllowedMcpEnvVar,
  isSensitiveMcpEnvVar,
} from "./configure-allowed-env-vars"

export function expandEnvVars(value: string): string {
  return value.replace(
    /\$\{([^}:]+)(?::-([^}]*))?\}/g,
    (_, varName: string, defaultValue?: string) => {
      if (!isAllowedMcpEnvVar(varName)) {
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
