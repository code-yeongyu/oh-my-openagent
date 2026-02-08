# FEATURES KNOWLEDGE BASE

## OVERVIEW

Background agents, skills, Claude Code compat, builtin commands, MCP managers, etc.

## STRUCTURE

features/
├── background-agent/                      # Task lifecycle, concurrency (manager.ts 1642 lines)
├── builtin-skills/                       # Skills like git-master (1107 lines)
├── builtin-commands/                     # Commands like refactor (619 lines)
├── skill-mcp-manager/                    # MCP client lifecycle (640 lines)
├── claude-code-plugin-loader/            # Plugin loading
├── claude-code-mcp-loader/               # MCP loading
├── claude-code-session-state/            # Session state
├── claude-code-command-loader/           # Command loading
├── claude-code-agent-loader/             # Agent loading
├── context-injector/                     # Context injection
├── hook-message-injector/                # Message injection
├── task-toast-manager/                   # Task toasts
├── boulder-state/                        # State management
├── tmux-subagent/                        # Tmux subagent
├── mcp-oauth/                            # OAuth for MCP
├── opencode-skill-loader/                # Skill loading
├── tool-metadata-store/                  # Tool metadata

## HOW TO ADD

Create dir with index.ts, types.ts, etc.
