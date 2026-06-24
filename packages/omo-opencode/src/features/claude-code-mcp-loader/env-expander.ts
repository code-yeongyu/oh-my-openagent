import { expandEnvReferences, expandEnvReferencesInObject } from "@oh-my-opencode/utils"
import { log } from "../../shared/logger"
import {
  isAllowedMcpEnvVar,
  isSensitiveMcpEnvVar,
} from "./configure-allowed-env-vars"

export interface ExpandEnvVarsOptions {
  trusted?: boolean
}

function logBlockedEnvVar(varName: string): void {
  const isSensitive = isSensitiveMcpEnvVar(varName)
  const reason = isSensitive ? "sensitive variable" : "not in allowlist"

  log(`Blocked MCP env var expansion for ${reason} "${varName}"`, {
    varName,
    sensitive: isSensitive,
  })
}

export function expandEnvVars(value: string, options: ExpandEnvVarsOptions = {}): string {
  return expandEnvReferences(value, {
    trusted: options.trusted ?? false,
    isAllowed: isAllowedMcpEnvVar,
    onBlocked: logBlockedEnvVar,
  })
}

export function expandEnvVarsInObject<T>(obj: T, options: ExpandEnvVarsOptions = {}): T {
  return expandEnvReferencesInObject(obj, {
    trusted: options.trusted ?? false,
    isAllowed: isAllowedMcpEnvVar,
    onBlocked: logBlockedEnvVar,
  }) as T
}
