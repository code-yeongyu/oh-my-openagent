# src/tools/skill/ -- Skill and Command Loader Tool

**Generated:** 2026-05-18

## OVERVIEW

The `skill` tool. Dual purpose: (1) load a skill by name to inject its SKILL.md content into context, (2) invoke a slash command by name (omit leading slash). Skills may spin up embedded MCP servers on demand. Commands route through the autoSlashCommand hook.

## FILE CATALOG

| File | Purpose |
|------|---------|
| `tools.ts` | `createSkillTool` factory -- resolves name, loads body, returns formatted output |
| `skill-body.ts` | Extracts `<skill-instruction>` block or full SKILL.md template |
| `skill-matcher.ts` | Exact match, short-name fallback, partial-match suggestions |
| `scope-priority.ts` | 4-scope priority: project (4) > user (3) > opencode (2) > builtin/plugin (1) |
| `native-skills.ts` | Merges `PluginInput.skills` entries into discovered skill list |
| `description-formatter.ts` | Builds LLM-visible `<available_items>` listing with scope tags |
| `mcp-capability-formatter.ts` | Lists skill-embedded MCP tools/resources/prompts for `skill_mcp` calls |
| `session-skill-cache.ts` | Dedupes repeated skill loads per session via `seenSessionIDs` |
| `types.ts` | `SkillArgs`, `SkillInfo`, `SkillLoadOptions` |
| `constants.ts` | Tool name and description prefix |
| `index.ts` | Barrel exports |

## EXECUTION FLOW

```
skill(name="git-master")
  -> matchSkillByName()    # exact, then short-name
  -> ask(permission)       # host skill permission gate
  -> extractSkillBody()    # load SKILL.md content
  -> formatMcpCapabilities()  # if skill has mcpConfig
  -> return "## Skill: ..." + body + MCP info
```

## SCOPE PRIORITY

Project configs override user configs, which override opencode builtins. `sortByScopePriority` applies to both skills and slash commands in the `<available_items>` listing.

## TEST MOCKS

`zauc-mocks-skill-tools/` -- `mock.module()` setup for skill tool tests. Loads alphabetically before consuming tests via the `zauc-` prefix sort-order hack.

## INTEGRATION

- Discovery: `opencode-skill-loader` feature module scans `.opencode/skills/`, `~/.config/opencode/skills/`, and built-in paths
- MCP spawn: `skill-mcp-manager` feature module starts embedded MCP servers per session on demand
- Commands: `slashcommand/` module feeds discovered commands into the tool description
