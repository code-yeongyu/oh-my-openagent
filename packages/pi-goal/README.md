# pi-goal

Persistent `/goal` support for pi. The extension ports the useful parts of Codex goal mode into a pi package: a session-scoped goal store, Codex-style TUI footer indicator, hidden continuation prompts, token/time accounting, and agent-callable tools.

## Installation

```bash
pi install npm:pi-goal
```

For local development:

```bash
pi -e ./src/index.ts
```

## Commands

```bash
/goal <objective>
/goal
/goal pause
/goal resume
/goal clear
```

Goals are stored under Pi's active session directory, keyed by session id. If Pi is launched without a persisted session, the extension falls back to `$PI_CODING_AGENT_DIR/extensions/pi-goal/...`. That means `PI_CODING_AGENT_DIR=$HOME/.senpi/agent` keeps goal state under `~/.senpi/agent/...` even when pi is launched from a workspace such as `~/local-workspaces/senpi-mono`.

## Agent Tools

- `create_goal({ objective, token_budget? })` creates a new active goal. This follows Codex's model-facing schema.
- `update_goal({ status: "complete" })` only marks the current goal complete. Pause, resume, budget-limited, and clear transitions are user/system controlled.
- `get_goal({})` returns the current goal summary.

Statuses are `active`, `paused`, `budgetLimited`, and `complete`. When a goal reaches its token budget, the extension marks it `budgetLimited` and queues a prompt asking the agent to summarize remaining work instead of silently continuing.

## TUI Behavior

When a goal exists, pi keeps the normal footer information and renders the Codex-style goal indicator on the bottom-right footer line: `Pursuing goal (...)`, `Goal paused (/goal resume)`, `Goal unmet (...)`, or `Goal achieved (...)`. The older below-editor goal widget is cleared.

On session start, after `/goal <objective>`, after `/goal resume`, and after every agent turn that leaves the goal `active`, the extension queues Codex's goal continuation prompt as hidden model-visible context. The objective is XML-escaped and wrapped as untrusted user data so it does not become higher-priority instructions.

## Development

```bash
npm test
npm run typecheck
npm run check
npm run no-excuse
npm pack --dry-run
```

The implementation is strict TypeScript and mirrors sibling pi extension metadata, CI, and package layout. `npm run check` runs `tsgo --noEmit`, `biome check .`, and the TypeScript no-excuse checker.

## Related

- [senpi](https://github.com/code-yeongyu/senpi) — the fork/runtime these extensions are extracted from.
- [Ultraworkers Discord](https://discord.gg/PUwSMR9XNk) — community link from the senpi README.
- [Dori](https://sisyphuslabs.ai) — the product powered by senpi under the hood.
