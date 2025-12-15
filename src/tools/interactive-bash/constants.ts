export const DEFAULT_TIMEOUT_MS = 60_000

export const INTERACTIVE_BASH_DESCRIPTION = `Execute tmux commands for interactive terminal session management.

This tool provides access to tmux for creating and managing persistent terminal sessions.
Use it to run interactive CLI applications, maintain long-running processes, or work with multiple terminal sessions.

Parameters:
- tmux_command: The tmux command to execute (e.g., "new-session -d -s omo-dev", "send-keys -t omo-dev 'ls' Enter")

Examples:
- Create session: "new-session -d -s omo-test"
- Send keys: "send-keys -t omo-test 'npm run dev' Enter"
- Capture output: "capture-pane -t omo-test -p"
- List sessions: "list-sessions"
- Kill session: "kill-session -t omo-test"

Notes:
- Session names should follow the pattern "omo-{name}" for automatic tracking
- Use -d flag with new-session to create detached sessions
- Use capture-pane -p to retrieve terminal output`
