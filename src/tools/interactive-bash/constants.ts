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

export const INTERACTIVE_BASH_DESCRIPTION = `WARNING: This is for terminal multiplexers (tmux/zellij). Pass multiplexer subcommands directly (without 'tmux'/'zellij' prefix).

Examples (tmux): new-session -d -s omo-dev, send-keys -t omo-dev "vim" Enter
Examples (zellij): action new-pane -d horizontal -n my-pane

For TUI apps needing ongoing interaction (vim, htop, pudb). One-shot commands → use Bash with &.`
