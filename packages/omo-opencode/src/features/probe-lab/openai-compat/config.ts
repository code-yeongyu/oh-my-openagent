import { OpenAICompatConfigSchema, type OpenAICompatConfig } from "./config-schema"
import { DEFAULT_OPENAI_COMPAT_HOST, DEFAULT_OPENAI_COMPAT_PORT_START } from "./defaults"

const ENV_BEARER_TOKEN = "IDM_OPENAI_COMPAT_BEARER_TOKEN"
const ENV_HOST = "IDM_OPENAI_COMPAT_HOST"
const ENV_PORT = "IDM_OPENAI_COMPAT_PORT"
const ENV_VERSION = "IDM_OPENAI_COMPAT_VERSION"

export class OpenAICompatConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "OpenAICompatConfigError"
  }
}

export function resolveOpenAICompatConfig(
  env: Record<string, string | undefined> = process.env,
): OpenAICompatConfig {
  const bearer = env[ENV_BEARER_TOKEN]
  if (!bearer || bearer.length === 0) {
    throw new OpenAICompatConfigError(
      `${ENV_BEARER_TOKEN} environment variable is required to start the OpenAI-compat server`,
    )
  }

  const port = parsePort(env[ENV_PORT])
  const host = env[ENV_HOST] ?? DEFAULT_OPENAI_COMPAT_HOST
  const version = env[ENV_VERSION] ?? "0.4.0"

  const parsed = OpenAICompatConfigSchema.safeParse({
    host,
    port,
    bearer_token: bearer,
    version,
  })

  if (!parsed.success) {
    throw new OpenAICompatConfigError(
      `Invalid OpenAI-compat config: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    )
  }

  return parsed.data
}

function parsePort(raw: string | undefined): number {
  if (!raw) return DEFAULT_OPENAI_COMPAT_PORT_START
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 65_535) {
    throw new OpenAICompatConfigError(`Invalid ${ENV_PORT}: ${raw}`)
  }
  return parsed
}
