// Filters npm/pnpm/yarn config env vars that break MCP servers in pnpm projects (#456)
export const EXCLUDED_ENV_PATTERNS: RegExp[] = [
  /^NPM_CONFIG_/i,
  /^npm_config_/,
  /^YARN_/,
  /^PNPM_/,
  /^NO_UPDATE_NOTIFIER$/,
]

export function createCleanMcpEnvironment(
  customEnv: Record<string, string> = {}
): Record<string, string> {
  const cleanEnv: Record<string, string> = {}

  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue

    const shouldExclude = EXCLUDED_ENV_PATTERNS.some((pattern) => pattern.test(key))
    if (!shouldExclude) {
      cleanEnv[key] = value
    }
  }

  Object.assign(cleanEnv, customEnv)

  return cleanEnv
}
