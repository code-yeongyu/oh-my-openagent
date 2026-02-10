# FEATURES KNOWLEDGE BASE

## OVERVIEW

18 feature modules extending plugin capabilities: agent orchestration, skill loading, Claude Code compatibility, MCP management, task storage, and tmux integration.

## STRUCTURE
```
features/
├── background-agent/           # Task lifecycle, concurrency (50 files, 8330 LOC)
│   ├── manager.ts              # Main task orchestration (1646 lines)
│   ├── concurrency.ts          # Parallel execution limits per provider/model
│   └── spawner/                # Task spawning utilities (8 files)
├── tmux-subagent/              # Tmux integration (28 files, 3303 LOC)
│   └── manager.ts              # Pane management, grid planning (350 lines)
├── opencode-skill-loader/      # YAML frontmatter skill loading (28 files, 2967 LOC)
│   ├── loader.ts               # Skill discovery (4 scopes)
│   ├── skill-directory-loader.ts # Recursive directory scanning
│   ├── skill-discovery.ts      # getAllSkills() with caching
│   └── merger/                 # Skill merging with scope priority
├── mcp-oauth/                  # OAuth 2.0 flow for MCP (18 files, 2164 LOC)
│   ├── provider.ts             # McpOAuthProvider class
│   ├── oauth-authorization-flow.ts # PKCE, callback handling
│   └── dcr.ts                  # Dynamic Client Registration (RFC 7591)
├── skill-mcp-manager/          # MCP client lifecycle per session (12 files, 1769 LOC)
│   └── manager.ts              # SkillMcpManager class (150 lines)
├── builtin-skills/             # 5 built-in skills (10 files, 1921 LOC)
│   └── skills/                 # git-master (1111), playwright, dev-browser, frontend-ui-ux
├── builtin-commands/           # 6 command templates (11 files, 1511 LOC)
│   └── templates/              # refactor, ralph-loop, init-deep, handoff, start-work, stop-continuation
├── claude-tasks/               # Task schema + storage (7 files, 1165 LOC)
├── context-injector/           # AGENTS.md, README.md, rules injection (6 files, 809 LOC)
├── claude-code-plugin-loader/  # Plugin discovery from .opencode/plugins/ (10 files)
├── claude-code-mcp-loader/     # .mcp.json with ${VAR} expansion (6 files)
├── claude-code-command-loader/ # Command loading from .opencode/commands/ (3 files)
├── claude-code-agent-loader/   # Agent loading from .opencode/agents/ (3 files)
├── claude-code-session-state/  # Subagent session state tracking (3 files)
├── hook-message-injector/      # System message injection (4 files)
├── task-toast-manager/         # Task progress notifications (4 files)
├── boulder-state/              # Persistent state for multi-step ops (5 files)
└── tool-metadata-store/        # Tool execution metadata caching (3 files)
```

## KEY PATTERNS

**Background Agent Lifecycle:**
Task creation → Queue → Concurrency check → Execute → Monitor/Poll → Notification → Cleanup

**Skill Loading Pipeline (4-scope priority):**
opencode-project (`.opencode/skills/`) > opencode (`~/.config/opencode/skills/`) > project (`.claude/skills/`) > user (`~/.claude/skills/`)

**Claude Code Compatibility Layer:**
5 loaders: agent-loader, command-loader, mcp-loader, plugin-loader, session-state

**SKILL.md Format:**
```yaml
---
name: my-skill
description: "..."
model: "claude-opus-4-6"    # optional
agent: "sisyphus"           # optional
mcp:                        # optional embedded MCPs
  server-name:
    type: http
    url: https://...
---
# Skill instruction content
```

## HOW TO ADD

1. Create directory under `src/features/`
2. Add `index.ts`, `types.ts`, `constants.ts` as needed
3. Export from `index.ts` following barrel pattern
4. Register in main plugin if plugin-level feature

## CHILD DOCUMENTATION

- See `claude-tasks/AGENTS.md` for task schema and storage details
