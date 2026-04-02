const BUILTIN_ALLOWED_MCP_ENV_VARS = ["PATH", "HOME", "USER", "SHELL", "TERM"]
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
