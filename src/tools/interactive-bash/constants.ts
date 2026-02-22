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

export const INTERACTIVE_BASH_DESCRIPTION = `WARNING: This is TMUX ONLY. Pass tmux subcommands directly (without 'tmux' prefix).

Examples: new-session -d -s omo-dev, send-keys -t omo-dev "vim" Enter

For TUI apps needing ongoing interaction (vim, htop, pudb). One-shot commands → use Bash with &.`
