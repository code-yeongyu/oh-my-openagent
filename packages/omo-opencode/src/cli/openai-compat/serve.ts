import { createOpenAICompatServer } from "../../features/probe-lab/openai-compat"
import { resolveBearer, bearerSecretPath } from "./bearer-resolver"

const DEFAULT_PORT = 28128
const DEFAULT_HOST = "127.0.0.1"
const PROVIDER_IDS_ENV = "IDM_OPENAI_COMPAT_PROVIDER_IDS"
const PROVIDER_ID_ENV = "IDM_OPENAI_COMPAT_PROVIDER_ID"

export type ServeOptions = {
  host?: string
  port?: number
  bearer?: string
  providerIds?: string
  version?: string
}

export async function runServe(options: ServeOptions = {}): Promise<void> {
  const bearer = resolveBearer(options.bearer)
  applyProviderIdsEnv(options.providerIds)
  warnIfNoProviders()
  const server = await createOpenAICompatServer({
    host: options.host ?? DEFAULT_HOST,
    port: options.port ?? DEFAULT_PORT,
    bearer_token: bearer.token,
    version: options.version ?? "idm-sidecar",
  })
  printStartupSummary(server.url, bearer.token, bearer.source, bearer.filePath)
  registerShutdownHandlers(server)
  await waitForever()
}

function applyProviderIdsEnv(arg?: string): void {
  if (!arg) return
  process.env[PROVIDER_IDS_ENV] = arg
}

function warnIfNoProviders(): void {
  if (process.env[PROVIDER_IDS_ENV] || process.env[PROVIDER_ID_ENV]) return
  process.stderr.write(
    `[idm openai-compat] WARN: ${PROVIDER_IDS_ENV} not set; defaulting to "deepseek-web".\n` +
      `  Set via --providers <id1,id2> or env var to use specific probe-lab providers.\n`,
  )
}

function printStartupSummary(
  url: string,
  bearer: string,
  source: string,
  filePath?: string,
): void {
  const lines = [
    "",
    "idm openai-compat sidecar running",
    "  URL:    " + url + "/v1",
    "  Bearer: " + bearer,
    "  Source: " + source + (filePath ? " (" + filePath + ")" : ""),
    "",
    "Add to 9router via dashboard > Custom OpenAI-compatible provider:",
    "  Base URL: " + url + "/v1",
    "  API Key:  <Bearer above>",
    "  Models:   deepseek-v4-flash, deepseek-v4-pro, deepseek-v4-vision",
    "",
    "Press Ctrl+C to stop.",
    "",
  ]
  process.stdout.write(lines.join("\n"))
}

function registerShutdownHandlers(server: {
  stop: () => Promise<void>
}): void {
  let stopping = false
  const stop = async (signal: string) => {
    if (stopping) return
    stopping = true
    process.stderr.write(`\n[idm openai-compat] received ${signal}, stopping...\n`)
    try {
      await server.stop()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      process.stderr.write(`[idm openai-compat] stop error: ${message}\n`)
    }
    process.exit(0)
  }
  process.on("SIGINT", () => void stop("SIGINT"))
  process.on("SIGTERM", () => void stop("SIGTERM"))
}

function waitForever(): Promise<never> {
  return new Promise<never>(() => {})
}

export function defaultBearerFilePath(): string {
  return bearerSecretPath()
}
