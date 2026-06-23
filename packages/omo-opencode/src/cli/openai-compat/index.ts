import { Command } from "commander"
import { runServe, defaultBearerFilePath } from "./serve"

function parsePort(value: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 65_535) {
    throw new Error(`--port must be 0-65535 (got '${value}')`)
  }
  return parsed
}

function wrap(action: (...args: unknown[]) => Promise<unknown>) {
  return async (...args: unknown[]) => {
    try {
      await action(...args)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      process.stderr.write(`Error: ${message}\n`)
      process.exitCode = 1
    }
  }
}

export function createOpenAICompatCommand(): Command {
  const cmd = new Command("openai-compat").description(
    "Start the idm OpenAI-compatible sidecar that fronts chat.deepseek.com for 9router/other clients",
  )

  cmd
    .command("serve")
    .description(
      `Start the sidecar on a known port (default 28128). Bearer is read from --bearer, env IDM_OPENAI_COMPAT_BEARER, file ${defaultBearerFilePath()}, or auto-generated on first run.`,
    )
    .option("--port <n>", "TCP port to listen on (default 28128)", parsePort)
    .option("--host <host>", "Bind host (default 127.0.0.1)")
    .option(
      "--bearer <token>",
      "Explicit bearer token; overrides env and file (NOT logged to disk when explicit)",
    )
    .option(
      "--providers <ids>",
      "Comma-separated probe-lab provider ids (default reads IDM_OPENAI_COMPAT_PROVIDER_IDS env or deepseek-web)",
    )
    .action(
      wrap(async (options: unknown) => {
        const opts = options as {
          port?: number
          host?: string
          bearer?: string
          providers?: string
        }
        await runServe({
          host: opts.host,
          port: opts.port,
          bearer: opts.bearer,
          providerIds: opts.providers,
        })
      }),
    )

  return cmd
}
