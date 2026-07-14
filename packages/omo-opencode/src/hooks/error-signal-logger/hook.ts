import { appendFileSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"

const ERR_LOG_DIR = ".matrix/logs"
const ERR_LOG_FILE = join(ERR_LOG_DIR, "errors.jsonl")

export type ErrorSignal = {
  agent: string
  errorType: string
  message: string
  context?: string
  timestamp: string
  sessionId?: string
}

const PATTERNS: ReadonlyArray<{ type: string; re: RegExp }> = [
  { type: "timeout", re: /timeout|timed out/i },
  { type: "api-error", re: /\b5\d\d\b|api error|api fail/i },
  { type: "runtime-error", re: /\bexception\b|error:|failed to|failures?:/i },
]

function appendSignal(signal: ErrorSignal): void {
  if (!existsSync(ERR_LOG_DIR)) mkdirSync(ERR_LOG_DIR, { recursive: true })
  appendFileSync(ERR_LOG_FILE, JSON.stringify(signal) + "\n", "utf8")
}

export function createErrorSignalLoggerHook(): ErrorSignalLoggerHook {
  return {
    "tool.execute.after": async (input, output) => {
      const text = output?.output
      if (typeof text !== "string" || text.length === 0) return
      const agent =
        typeof output.metadata?.agent === "string" ? output.metadata.agent : "unknown"
      for (const { type, re } of PATTERNS) {
        if (re.test(text)) {
          appendSignal({
            agent,
            errorType: type,
            message: text.slice(0, 200),
            timestamp: new Date().toISOString(),
            sessionId: input?.sessionID,
          })
          break
        }
      }
    },
  }
}

export type ErrorSignalLoggerHook = {
  "tool.execute.after"?: (
    input: { tool: string; sessionID: string; callID?: string; args?: Record<string, unknown> },
    output: { title: string; output: string; metadata: Record<string, unknown> },
  ) => Promise<void>
}

export const ERROR_SIGNAL_LOGGER_HOOK_NAME = "error-signal-logger"
