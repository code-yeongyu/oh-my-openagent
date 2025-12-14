export const HOOK_NAME = "interactive-bash-blocker"

export const INTERACTIVE_FLAG_PATTERNS = [
  /\bgit\s+(?:rebase|add|stash|reset|checkout|commit|merge|revert|cherry-pick)\s+.*-i\b/,
  /\bgit\s+(?:rebase|add|stash|reset|checkout|commit|merge|revert|cherry-pick)\s+.*--interactive\b/,
  /\bgit\s+.*-p\b/,
  /\bgit\s+add\s+.*--patch\b/,
  /\bgit\s+stash\s+.*--patch\b/,
  
  /\b(?:vim?|nvim|nano|emacs|pico|joe|micro|helix|hx)\b/,
  
  /^\s*(?:python|python3|ipython|node|bun|deno|irb|pry|ghci|erl|iex|lua|R)\s*$/,
  
  /\btop\b(?!\s+\|)/,
  /\bhtop\b/,
  /\bbtop\b/,
  /\bless\b(?!\s+\|)/,
  /\bmore\b(?!\s+\|)/,
  /\bman\b/,
  /\bwatch\b/,
  /\bssh\b(?!.*-[oTNf])/,
  /\btelnet\b/,
  /\bftp\b/,
  /\bsftp\b/,
  /\bmysql\b(?!.*-e)/,
  /\bpsql\b(?!.*-c)/,
  /\bmongo\b(?!.*--eval)/,
  /\bredis-cli\b(?!.*[^\s])/,
  
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
  
  /\bapt\s+(?:install|remove|upgrade|dist-upgrade)\b(?!.*-y)/,
  /\bapt-get\s+(?:install|remove|upgrade|dist-upgrade)\b(?!.*-y)/,
  /\byum\s+(?:install|remove|update)\b(?!.*-y)/,
  /\bdnf\s+(?:install|remove|update)\b(?!.*-y)/,
  /\bpacman\s+-S\b(?!.*--noconfirm)/,
  /\bbrew\s+(?:install|uninstall|upgrade)\b(?!.*--force)/,
  
  /\bread\b(?!\s+.*<)/,
  
  /\bselect\b.*\bin\b/,
]

export const STDIN_REQUIRING_COMMANDS = [
  "passwd",
  "su",
  "sudo -S",
  "gpg --gen-key",
  "ssh-keygen",
]

export const TMUX_SUGGESTION = `
[interactive-bash-blocker]
This command requires interactive input which is not supported in this environment.

**Recommendation**: Use tmux for interactive commands.

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
