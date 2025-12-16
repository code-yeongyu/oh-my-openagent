export const DEFAULT_TIMEOUT_MS = 60_000

export const BLOCKED_TMUX_SUBCOMMANDS = [
  "capture-pane",
  "capturep",
  "save-buffer",
  "saveb",
  "show-buffer",
  "showb",
  "pipe-pane",
  "pipep",
]

export const INTERACTIVE_BASH_DESCRIPTION = `Execute tmux commands. Use "omo-{name}" session pattern.

Blocked (use bash instead): capture-pane, save-buffer, show-buffer, pipe-pane.`
