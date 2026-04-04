// Filters npm/pnpm/yarn config env vars that break MCP servers in pnpm projects (#456)
// Also filters secret-containing env vars to prevent exposure to malicious stdio MCP servers (#B-02)
export const EXCLUDED_ENV_PATTERNS: RegExp[] = [
  // npm/pnpm/yarn config patterns (original)
  /^NPM_CONFIG_/i,
  /^npm_config_/,
  /^YARN_/,
  /^PNPM_/,
  /^NO_UPDATE_NOTIFIER$/,

  // Specific high-risk secret env vars (explicit blocks)
  /^ANTHROPIC_API_KEY$/i,
  /^AWS_ACCESS_KEY_ID$/i,
  /^AWS_SECRET_ACCESS_KEY$/i,
  /^GOOGLE_APPLICATION_CREDENTIALS$/i,
  /^GOOGLE_CLOUD_PROJECT$/i,
  /^GITHUB_TOKEN$/i,
  /^DATABASE_URL$/i,
  /^OPENAI_API_KEY$/i,
  /^AZURE_/i,
  /^GCP_/i,
  /^FIREBASE_/i,
  /^HEROKU_/i,
  /^DOCKER_AUTH/i,
  /^KUBECONFIG$/i,
  /^VAULT_/i,

  // Suffix-based patterns for common secret naming conventions
  /_KEY$/i,
  /_SECRET$/i,
  /_TOKEN$/i,
  /_PASSWORD$/i,
  /_CREDENTIAL$/i,
  /_CREDENTIALS$/i,
  /_API_KEY$/i,
]

export function createCleanMcpEnvironment(
  customEnv: Record<string, string> = {}
): Record<string, string> {
  const mergedEnv: Record<string, string> = {}

  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    mergedEnv[key] = value
  }

  Object.assign(mergedEnv, customEnv)

  const cleanEnv: Record<string, string> = {}
  for (const [key, value] of Object.entries(mergedEnv)) {
    const shouldExclude = EXCLUDED_ENV_PATTERNS.some((pattern) => pattern.test(key))
    if (!shouldExclude) {
      cleanEnv[key] = value
    }
  }

  return cleanEnv
}
