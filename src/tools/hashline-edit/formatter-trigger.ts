import path from "path"
import { log } from "../../shared"

interface FormatterConfig {
  disabled?: boolean
  command?: string[]
  environment?: Record<string, string>
  extensions?: string[]
}

interface OpencodeConfig {
  formatter?:
    | false
    | Record<string, FormatterConfig>
  experimental?: {
    hook?: {
      file_edited?: Record<string, Array<{ command: string[]; environment?: Record<string, string> }>>
    }
  }
}

interface OpencodeClient {
  config: {
    get: (options?: { query?: { directory?: string } }) => Promise<{ data?: OpencodeConfig }>
  }
}

let cachedFormatters: Map<string, Array<{ command: string[]; environment: Record<string, string> }>> | null = null

async function resolveFormatters(
  client: OpencodeClient,
  directory: string,
): Promise<Map<string, Array<{ command: string[]; environment: Record<string, string> }>>> {
  if (cachedFormatters) return cachedFormatters

  const result = new Map<string, Array<{ command: string[]; environment: Record<string, string> }>>()

  try {
    const response = await client.config.get({ query: { directory } })
    const config = response.data
    if (!config) return result

    if (config.formatter && typeof config.formatter === "object") {
      for (const [, formatter] of Object.entries(config.formatter)) {
        if (formatter.disabled || !formatter.command?.length || !formatter.extensions?.length) continue
        for (const ext of formatter.extensions) {
          const normalizedExt = ext.startsWith(".") ? ext : `.${ext}`
          const existing = result.get(normalizedExt) ?? []
          existing.push({
            command: formatter.command,
            environment: formatter.environment ?? {},
          })
          result.set(normalizedExt, existing)
        }
      }
    }

    if (config.experimental?.hook?.file_edited) {
      for (const [ext, commands] of Object.entries(config.experimental.hook.file_edited)) {
        const normalizedExt = ext.startsWith(".") ? ext : `.${ext}`
        const existing = result.get(normalizedExt) ?? []
        for (const cmd of commands) {
          existing.push({
            command: cmd.command,
            environment: cmd.environment ?? {},
          })
        }
        result.set(normalizedExt, existing)
      }
    }
  } catch (error) {
    log("[formatter-trigger] Failed to fetch formatter config", { error })
  }

  cachedFormatters = result
  return result
}

function buildFormatterCommand(command: string[], filePath: string): string[] {
  return command.map((arg) => arg.replace(/\$FILE/g, filePath))
}

export async function runFormattersForFile(
  client: OpencodeClient,
  directory: string,
  filePath: string,
): Promise<void> {
  const ext = path.extname(filePath)
  if (!ext) return

  const formatters = await resolveFormatters(client, directory)
  const matching = formatters.get(ext)
  if (!matching?.length) return

  for (const formatter of matching) {
    const cmd = buildFormatterCommand(formatter.command, filePath)
    try {
      log("[formatter-trigger] Running formatter", { command: cmd, file: filePath })
      const proc = Bun.spawn(cmd, {
        cwd: directory,
        env: { ...process.env, ...formatter.environment },
        stdout: "ignore",
        stderr: "pipe",
      })
      await proc.exited
      if (proc.exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text()
        log("[formatter-trigger] Formatter failed", {
          command: cmd,
          exitCode: proc.exitCode,
          stderr: stderr.slice(0, 500),
        })
      }
    } catch (error) {
      log("[formatter-trigger] Formatter execution error", { command: cmd, error })
    }
  }
}

export function clearFormatterCache(): void {
  cachedFormatters = null
}
