export const SPARKSHELL_USAGE = [
  "Usage: omo sparkshell <command> [args...]",
  "   or: omo sparkshell [--json] [--budget <chars>] <command> [args...]",
  "   or: omo sparkshell --shell '<shell command>'",
  "   or: omo sparkshell --tmux-pane <pane-id> [--tail-lines <100-1000>]",
  "Runs Sparkshell with a native sidecar when configured, otherwise falls back to raw command execution.",
  "Shell metacharacters are interpreted only with explicit --shell opt-in.",
  "Environment: OMO_SPARKSHELL_BIN selects the native sidecar path.",
  "When CODEX_THREAD_ID (or OMO_SPARKSHELL_SESSION_ID) identifies a Codex session, recent session context",
  "is appended after the shell result. OMO_SPARKSHELL_SESSION_CONTEXT=0 disables the attachment.",
  "Oversized output is condensed to a budget (default 20000 chars; --budget <chars> or",
  "OMO_SPARKSHELL_CONDENSE_BUDGET overrides) preserving error signatures, repeated patterns,",
  "session-goal matches, and head/tail. OMO_SPARKSHELL_CONDENSE=0 disables condensation.",
  "Before that deterministic condensation, oversized output is summarized by the spark model",
  "(codex exec; default gpt-5.3-codex-spark) fed with the session context: the summary reproduces",
  "the output as-is, unmasked, and ends with a [sparkshell caption] line stating what was omitted.",
  "OMO_SPARKSHELL_SPARK=0 disables it; OMO_SPARKSHELL_SPARK_MODEL / OMO_SPARKSHELL_SPARK_TIMEOUT_MS /",
  "OMO_SPARKSHELL_SPARK_BIN tune the invocation. Condensation is the automatic fallback.",
].join("\n")

export type SparkShellFallbackInvocation =
  | { readonly kind: "command"; readonly argv: readonly string[] }
  | { readonly kind: "tmux-pane"; readonly argv: readonly string[] }

type RuntimeEnv = Readonly<Record<string, string | undefined>>

type StripResult = {
  readonly args: readonly string[]
}

export function resolveFallbackShellArgv(
  script: string,
  options: {
    readonly platform?: NodeJS.Platform
    readonly env?: RuntimeEnv
    readonly commandExists?: (command: string) => boolean
  } = {},
): readonly string[] {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const commandExists = options.commandExists ?? (() => false)

  if (platform !== "win32") {
    return ["sh", "-lc", script]
  }
  if (commandExists("pwsh")) {
    return ["pwsh", "-NoLogo", "-NoProfile", "-Command", script]
  }
  if (commandExists("powershell.exe")) {
    return ["powershell.exe", "-NoLogo", "-NoProfile", "-Command", script]
  }
  return [env["ComSpec"]?.trim() || "cmd.exe", "/d", "/s", "/c", script]
}

export function parseSparkShellFallbackInvocation(
  rawArgs: readonly string[],
  options: {
    readonly platform?: NodeJS.Platform
    readonly env?: RuntimeEnv
    readonly commandExists?: (command: string) => boolean
  } = {},
): SparkShellFallbackInvocation {
  const args = stripSparkShellOptions(rawArgs).args
  if (args.length === 0) {
    throw new Error(`Missing command to run.\n${SPARKSHELL_USAGE}`)
  }

  if (args[0] === "--shell") {
    const script = args[1]
    if (!script) {
      throw new Error(`--shell requires a command string.\n${SPARKSHELL_USAGE}`)
    }
    return { kind: "command", argv: resolveFallbackShellArgv(script, options) }
  }

  if (args[0]?.startsWith("--shell=")) {
    const script = args[0].slice("--shell=".length)
    if (script.trim().length === 0) {
      throw new Error(`--shell requires a command string.\n${SPARKSHELL_USAGE}`)
    }
    return { kind: "command", argv: resolveFallbackShellArgv(script, options) }
  }

  if (args[0] === "--tmux-pane" || args[0]?.startsWith("--tmux-pane=")) {
    return parseTmuxPaneInvocation(args, options.commandExists ?? (() => false))
  }

  return { kind: "command", argv: args }
}

export function hasTopLevelSparkShellHelpFlag(args: readonly string[]): boolean {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (token === "--") {
      return false
    }
    if (token === "--help" || token === "-h") {
      return true
    }
    if (token === "--json") {
      continue
    }
    if (token === "--budget") {
      const next = args[index + 1]
      if (!next || next.startsWith("-")) {
        return false
      }
      index += 1
      continue
    }
    if (token?.startsWith("--budget=")) {
      continue
    }
    return false
  }
  return false
}

const MIN_BUDGET_CHARS = 2000

export function parseTopLevelSparkShellBudget(args: readonly string[]): number | null {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (token === "--" ) {
      return null
    }
    if (token === "--json") {
      continue
    }
    if (token === "--budget") {
      return normalizeBudget(args[index + 1])
    }
    if (token?.startsWith("--budget=")) {
      return normalizeBudget(token.slice("--budget=".length))
    }
    return null
  }
  return null
}

function normalizeBudget(rawValue: string | undefined): number | null {
  if (!rawValue || rawValue.startsWith("-")) {
    return null
  }
  const parsed = Number.parseInt(rawValue, 10)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return null
  }
  return Math.max(MIN_BUDGET_CHARS, parsed)
}

export function hasTopLevelSparkShellJsonFlag(args: readonly string[]): boolean {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (token === "--") {
      return false
    }
    if (token === "--json") {
      return true
    }
    if (token === "--budget") {
      const next = args[index + 1]
      if (!next || next.startsWith("-")) {
        return false
      }
      index += 1
      continue
    }
    if (token?.startsWith("--budget=")) {
      continue
    }
    return false
  }
  return false
}

export function stripTopLevelSparkShellArgs(args: readonly string[]): readonly string[] {
  return stripSparkShellOptions(args).args
}

function parseTmuxPaneInvocation(args: readonly string[], commandExists: (command: string) => boolean): SparkShellFallbackInvocation {
  if (!commandExists("tmux")) {
    throw new Error(`tmux is required for --tmux-pane mode.\n${SPARKSHELL_USAGE}`)
  }

  let paneId: string | undefined
  let tailLines = 200

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (token === "--tmux-pane") {
      const next = args[index + 1]
      if (!next || next.startsWith("-")) {
        throw new Error(`--tmux-pane requires a pane id.\n${SPARKSHELL_USAGE}`)
      }
      paneId = next
      index += 1
      continue
    }
    if (token?.startsWith("--tmux-pane=")) {
      paneId = token.slice("--tmux-pane=".length).trim()
      if (paneId.length === 0) {
        throw new Error(`--tmux-pane requires a pane id.\n${SPARKSHELL_USAGE}`)
      }
      continue
    }
    if (token === "--tail-lines") {
      const next = args[index + 1]
      tailLines = parseTailLines(next)
      index += 1
      continue
    }
    if (token?.startsWith("--tail-lines=")) {
      tailLines = parseTailLines(token.slice("--tail-lines=".length))
      continue
    }
    throw new Error(`tmux pane mode does not accept an additional command.\n${SPARKSHELL_USAGE}`)
  }

  if (!paneId || paneId.trim().length === 0) {
    throw new Error(`--tmux-pane requires a pane id.\n${SPARKSHELL_USAGE}`)
  }
  return {
    kind: "tmux-pane",
    argv: ["tmux", "capture-pane", "-p", "-t", paneId, "-S", `-${tailLines}`],
  }
}

function stripSparkShellOptions(args: readonly string[]): StripResult {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (token === "--") {
      return { args: args.slice(index + 1) }
    }
    if (token === "--json") {
      continue
    }
    if (token === "--budget") {
      const next = args[index + 1]
      if (!next || next.startsWith("-")) {
        throw new Error(`--budget requires a numeric value.\n${SPARKSHELL_USAGE}`)
      }
      index += 1
      continue
    }
    if (token?.startsWith("--budget=")) {
      continue
    }
    return { args: args.slice(index) }
  }
  return { args: [] }
}

function parseTailLines(rawValue: string | undefined): number {
  if (!rawValue || rawValue.startsWith("-")) {
    throw new Error(`--tail-lines requires a numeric value.\n${SPARKSHELL_USAGE}`)
  }
  const parsed = Number.parseInt(rawValue, 10)
  if (!Number.isSafeInteger(parsed) || parsed < 100 || parsed > 1000) {
    throw new Error(`--tail-lines must be an integer between 100 and 1000.\n${SPARKSHELL_USAGE}`)
  }
  return parsed
}
