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

export const INTERACTIVE_BASH_DESCRIPTION = `Execute tmux commands for interactive terminal session management.

Use session names following the pattern "omo-{name}" for automatic tracking.

BLOCKED COMMANDS (use bash tool instead):
- capture-pane / capturep: Use bash to read output files or pipe output
- save-buffer / saveb: Use bash to save content to files
- show-buffer / showb: Use bash to read buffer content
- pipe-pane / pipep: Use bash for piping output`
