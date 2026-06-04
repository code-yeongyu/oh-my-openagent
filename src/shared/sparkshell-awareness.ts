type RuntimeEnv = Readonly<Record<string, string | undefined>>

const SPARKSHELL_AWARENESS_MARKER = "## Sparkshell Runtime"

export function isCodexAppServerActive(env: RuntimeEnv = process.env): boolean {
  const originator = env["CODEX_INTERNAL_ORIGINATOR_OVERRIDE"]?.toLowerCase() ?? ""
  const bundleIdentifier = env["__CFBundleIdentifier"]?.toLowerCase() ?? ""
  const shellActive = isTruthy(env["CODEX_SHELL"])

  return shellActive && (
    originator.includes("codex desktop") ||
    originator.includes("codex app") ||
    bundleIdentifier === "com.openai.codex"
  )
}

export function getSparkShellRuntimeAwareness(env: RuntimeEnv = process.env): string {
  const override = env["OMO_SPARKSHELL_AWARENESS"] ?? env["LAZYCODEX_SPARKSHELL_AWARENESS"]
  if (isFalsy(override)) {
    return ""
  }
  if (!isTruthy(override) && !isCodexAppServerActive(env)) {
    return ""
  }

  return [
    SPARKSHELL_AWARENESS_MARKER,
    "",
    "- Codex app server context is active, so Sparkshell is available for shell-native inspection and bounded verification.",
    "- Use `omo sparkshell <command>` for direct argv execution. Use `omo sparkshell --shell '<command>'` only when shell metacharacters are required.",
    "- Use `omo sparkshell --tmux-pane <pane-id> --tail-lines 400` to summarize a tmux pane. Tail lines must stay between 100 and 1000.",
    "- Fallback boundaries are visible in output. `OMO_SPARKSHELL_BIN` selects a native sidecar path.",
  ].join("\n")
}

export function hasSparkShellRuntimeAwareness(value: string): boolean {
  return value.includes(SPARKSHELL_AWARENESS_MARKER)
}

function isTruthy(value: string | undefined): boolean {
  if (value === undefined) {
    return false
  }
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase())
}

function isFalsy(value: string | undefined): boolean {
  if (value === undefined) {
    return false
  }
  return ["0", "false", "no", "off"].includes(value.trim().toLowerCase())
}
