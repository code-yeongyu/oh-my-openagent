/**
 * Tmux Script keyword detector.
 *
 * Triggers when the user wants to generate a tmux script to set up,
 * start, and monitor their development environment.
 *
 * Trigger phrases:
 * - "tmux script", "tmux setup", "tmux session"
 * - "setup tmux", "create tmux", "generate tmux"
 * - "dev environment script", "dev setup script"
 */

export const TMUX_SCRIPT_PATTERN =
  /\b(tmux\s*script|tmux\s*setup|tmux\s*session|setup\s*tmux|create\s*tmux|generate\s*tmux|dev\s*environment\s*script|dev\s*setup\s*script)\b/i

export const TMUX_SCRIPT_MESSAGE = `[tmux-script-mode]
TMUX SCRIPT GENERATION MODE. Create a comprehensive tmux session script for the project.

## PHASE 1: Project Analysis (MANDATORY)

Before generating ANY script, analyze the project:

1. **Detect project type** - Read package.json, Makefile, docker-compose.yml, Procfile, etc.
2. **Identify all services** - dev servers, watchers, databases, queue workers, etc.
3. **Find existing scripts** - npm scripts, make targets, shell scripts in bin/ or scripts/
4. **Check port usage** - find all ports used by the project
5. **Detect test commands** - unit tests, integration tests, e2e tests

## PHASE 2: Script Generation

Generate a tmux script at \`./tmux-dev.sh\` that:

### Session Setup
\`\`\`bash
#!/usr/bin/env bash
# tmux-dev.sh - Development environment setup
# Generated for: [PROJECT_NAME]
# Usage: ./tmux-dev.sh [start|stop|status|logs]

SESSION_NAME="[project-name]-dev"
\`\`\`

### Required Panes (create based on what project needs):

| Pane | Purpose | Command |
|------|---------|---------|
| main | Primary dev server | npm run dev / cargo watch / etc. |
| tests | Test watcher | npm run test:watch / pytest-watch / etc. |
| logs | Log aggregation | tail -f logs/*.log or service logs |
| errors | Error monitor | Filter stderr, watch for crashes |
| build | Build watcher | tsc --watch / webpack --watch / etc. |
| services | Background services | docker-compose up / database / redis |

### Error Monitoring (CRITICAL)
The script MUST include an error monitoring pane that:
- Captures stderr from ALL running panes
- Pipes errors to a log file at \`/tmp/[project]-errors.log\`
- Highlights errors with color coding
- Shows timestamp for each error
- Supports \`tmux-dev.sh logs\` to view aggregated errors

### Script Features:
1. **start** - Create session, split panes, start all services
2. **stop** - Gracefully kill all processes, destroy session
3. **status** - Show which panes are running and their health
4. **logs** - Tail the error log file with highlighting
5. **restart [pane]** - Restart a specific pane's process
6. **attach** - Attach to the existing session

### Error Collection Pattern:
\`\`\`bash
# In each pane, redirect stderr to both the pane AND the error log
command 2>&1 | tee >(grep -i 'error\\|exception\\|fatal\\|panic\\|fail' >> /tmp/\${SESSION_NAME}-errors.log)
\`\`\`

### Health Checks:
- Periodically check if processes are still running
- Auto-restart crashed processes (with backoff)
- Send desktop notification on crash (if notify-send/osascript available)

## PHASE 3: Validation

After generating the script:
1. Make it executable: \`chmod +x tmux-dev.sh\`
2. Verify tmux is installed
3. Test the script syntax: \`bash -n tmux-dev.sh\`
4. Show the user how to use it

## RULES
- Script MUST be idempotent (safe to run multiple times)
- Script MUST handle the case where session already exists
- Script MUST clean up on exit (trap EXIT)
- Script MUST work on both macOS and Linux
- Use tmux 2.x compatible commands (no bleeding-edge features)
- All pane commands must log to /tmp/ for later error inspection
- NEVER hardcode paths - detect from project structure`
