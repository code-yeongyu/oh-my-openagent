# v2/ - OpenCode V2 host

## Purpose

Native OpenCode V2 host for oh-my-openagent. This directory is additive. The V1 host in `../` stays unchanged and continues to serve OpenCode 1.

## Boundary

- Do not import `@opencode-ai/*` or the V1 plugin pipeline from this directory.
- Use `@opencode/plugin` and the `Context` domains.
- Reuse harness-neutral workspace packages from `packages/*-core` when a domain needs their logic.
- Do not add a production stub. A subsystem is either registered with real behavior or absent.

## Structure

```text
index.ts        Plugin.define entry, bootstrap RPC, cleanup composition
managers/       V2-native background, skill MCP, monitor, tmux managers
tools/          tool registration and execution
hooks/          tool, prompt, context, compaction, event, fallback
agents/         agent definitions and dynamic prompts
config/         .omo/omo.jsonc loading and domain transforms
commands/       command registration
mcp/            built-in and configured MCP servers
skills/         shared, user, project, and runtime skills
orchestration/  background agents, todos, goal, boulder, team, monitor
tui/            OpenCode 2 TUI entry
compat/         event, message, and schema adapters
rpc/            diagnostic RPCs
```

## Verification

Every change under this directory needs the `opencode-qa` skill and real-host evidence under `.omo/evidence/`. Unit tests are necessary but not sufficient.

## Decisions

See `docs/DECISIONS_V2.md` at the repository root. Update that file when a decision changes.
