export const HOOK_NAME = "interactive-bash-blocker"

export const NON_INTERACTIVE_ENV = {
  CI: "true",
  DEBIAN_FRONTEND: "noninteractive",
  GIT_TERMINAL_PROMPT: "0",
  GCM_INTERACTIVE: "never",
  HOMEBREW_NO_AUTO_UPDATE: "1",
}

export const ALWAYS_BLOCK_PATTERNS = [
  /\b(?:vim?|nvim|nano|emacs|pico|joe|micro|helix|hx)\b/,
  /^\s*(?:python|python3|ipython|node|bun|deno|irb|pry|ghci|erl|iex|lua|R)\s*$/,
  /\btop\b(?!\s+\|)/,
  /\bhtop\b/,
  /\bbtop\b/,
  /\bless\b(?!\s+\|)/,
  /\bmore\b(?!\s+\|)/,
  /\bman\b/,
  /\bwatch\b/,
  /\bncurses\b/,
  /\bdialog\b/,
  /\bwhiptail\b/,
  /\bmc\b/,
  /\branger\b/,
  /\bnnn\b/,
  /\blf\b/,
  /\bvifm\b/,
  /\bgitui\b/,
  /\blazygit\b/,
  /\blazydocker\b/,
  /\bk9s\b/,
  /\bselect\b.*\bin\b/,
]

export const TMUX_SUGGESTION = `
[interactive-bash-blocker]
This command requires a full interactive terminal (TUI) which cannot be emulated.

**Recommendation**: Use tmux for TUI commands.

Example with interactive-terminal skill:
\`\`\`
# Start a tmux session
tmux new-session -d -s interactive

# Send your command
tmux send-keys -t interactive 'your-command-here' Enter

# Capture output
tmux capture-pane -t interactive -p
\`\`\`

Or use the 'interactive-terminal' skill for easier workflow.
`
