// Filters npm/pnpm/yarn config env vars that break MCP servers in pnpm projects (#456)
// Also filters secret-containing env vars to prevent exposure to malicious stdio MCP servers (#B-02)
export const EXCLUDED_ENV_PATTERNS: RegExp[] = [
  // npm/pnpm/yarn config patterns
  /^NPM_CONFIG_/i,
  /^YARN_/i,
  /^PNPM_/i,
  /^NO_UPDATE_NOTIFIER$/i,

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

function isExcludedEnvKey(key: string): boolean {
  return EXCLUDED_ENV_PATTERNS.some((pattern) => pattern.test(key))
}

export function createCleanMcpEnvironment(
  customEnv: Record<string, string> = {},
  ambientEnv: Record<string, string | undefined> = process.env
): Record<string, string> {
  const cleanEnv: Record<string, string> = {}

  // Apply the blacklist only to inherited ambient environment variables.
  // Skill-configured env entries are explicitly declared and must be passed
  // through as-is so stdio MCP servers can receive required credentials.
  for (const [key, value] of Object.entries(ambientEnv)) {
    if (value === undefined) continue
    if (isExcludedEnvKey(key)) continue
    cleanEnv[key] = value
  }

  Object.assign(cleanEnv, customEnv)

  return cleanEnv
}
