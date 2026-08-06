const BUILTIN_ALLOWED_MCP_ENV_VARS = [
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "TERM",
  "TMPDIR",
  "TMP",
  "TEMP",
  "PWD",
  "OLDPWD",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "EDITOR",
  "VISUAL",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "HOSTNAME",
  "LOGNAME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
]
const SENSITIVE_MCP_ENV_VAR_PATTERN = /KEY|TOKEN|SECRET|PASSWORD|AUTH|CREDENTIAL/i

let additionalAllowedMcpEnvVars = new Set<string>()

export function getAllowedMcpEnvVars(): Set<string> {
  return new Set([...BUILTIN_ALLOWED_MCP_ENV_VARS, ...additionalAllowedMcpEnvVars])
}

export function isSensitiveMcpEnvVar(varName: string): boolean {
  return SENSITIVE_MCP_ENV_VAR_PATTERN.test(varName)
}

export function isAllowedMcpEnvVar(varName: string): boolean {
  return getAllowedMcpEnvVars().has(varName)
}

export function setAdditionalAllowedMcpEnvVars(varNames: string[]): void {
  additionalAllowedMcpEnvVars = new Set(varNames)
}

export function resetAdditionalAllowedMcpEnvVars(): void {
  additionalAllowedMcpEnvVars = new Set()
}
