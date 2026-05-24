import { execSync } from "child_process"
import type { TerminalBackend } from "./types"

export function detectAvailableBackends(): TerminalBackend[] {
  const available: TerminalBackend[] = []
  const checks: [TerminalBackend, string][] = [
    ["tmux", "tmux -V"],
    ["zellij", "zellij --version"],
    ["windows-terminal", "wt --version 2>/dev/null"],
    ["kitty", "kitty --version 2>/dev/null"],
    ["iterm2", "osascript -e 'tell application \"iTerm2\" to version' 2>/dev/null"],
  ]
  for (const [backend, cmd] of checks) {
    try {
      execSync(cmd, { stdio: "ignore", timeout: 2000 })
      available.push(backend)
    } catch { continue }
  }
  return available
}

export function getPreferredBackend(preferred?: TerminalBackend): TerminalBackend {
  if (preferred) return preferred
  const available = detectAvailableBackends()
  if (available.includes("tmux")) return "tmux"
  if (available.includes("zellij")) return "zellij"
  if (available.includes("kitty")) return "kitty"
  if (available.includes("iterm2")) return "iterm2"
  if (available.includes("windows-terminal")) return "windows-terminal"
  return "tmux"
}
