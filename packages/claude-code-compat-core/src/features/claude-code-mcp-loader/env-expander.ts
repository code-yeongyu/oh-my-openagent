import { expandEnvReferences, expandEnvReferencesInObject } from "@oh-my-opencode/utils"
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
  return expandEnvReferences(value, {
    trusted,
    isAllowed: isAllowedMcpEnvVar,
    onBlocked: (varName) => {
      const isSensitive = isSensitiveMcpEnvVar(varName)
      const reason = isSensitive ? "sensitive variable" : "not in allowlist"

      log(`Blocked MCP env var expansion for ${reason} "${varName}"`, {
        varName,
        sensitive: isSensitive,
      })
    },
  })
}

export function expandEnvVarsInObject<T>(obj: T, options: ExpandEnvVarsOptions = {}): T {
  const { trusted = false } = options
  return expandEnvReferencesInObject(obj, {
    trusted,
    isAllowed: isAllowedMcpEnvVar,
    onBlocked: (varName) => {
      const isSensitive = isSensitiveMcpEnvVar(varName)
      const reason = isSensitive ? "sensitive variable" : "not in allowlist"

      log(`Blocked MCP env var expansion for ${reason} "${varName}"`, {
        varName,
        sensitive: isSensitive,
      })
    },
  }) as T
}
