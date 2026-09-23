# Issue #6866: TUI sidebar idle "Models" roster ignores disabled_agents

## Root cause

`resolveRoster()` in `packages/omo-opencode/src/features/tui-sidebar/roster-resolver.ts`
mapped every entry of `AGENT_MODEL_REQUIREMENTS` / `CATEGORY_MODEL_REQUIREMENTS`
(via `getModelResolutionInfoWithOverrides`) into roster rows without consulting
`config.disabled_agents`. The registration layer
(`packages/omo-opencode/src/plugin-handlers/agent-config-handler.ts`, lines 14-16)
normalizes `disabled_agents` through `AGENT_NAME_MAP` and skips disabled agents in
`createBuiltinAgents`, but the sidebar panel (added later, #5325) never picked up
that filtering. Result: a disabled agent such as `hephaestus` still rendered as
`hephaestus gpt-5.6-sol` (first entry of its fallback chain) in the idle view.

## Change

- `roster-resolver.ts`: new `collectDisabledAgentNames()` normalizes
  `config.disabled_agents` through the same `AGENT_NAME_MAP[lower] ?? AGENT_NAME_MAP[raw] ?? raw`
  chain used at registration, lowercases into a Set, and `resolveRoster()` filters
  disabled entries out of `resolution.agents` before mapping to rows. Categories are
  untouched (`disabled_agents` does not apply to them).
- `roster-resolver.test.ts`: two regression tests (given/when/then):
  1. canonical name `disabled_agents: ["hephaestus"]` excludes the hephaestus row,
     enabled agents still listed;
  2. legacy alias `"Hephaestus (Deep Agent)"` also excludes the canonical row.

## Verification

| Step | Command | Result |
|------|---------|--------|
| Failing first | `bun test packages/omo-opencode/src/features/tui-sidebar/roster-resolver.test.ts` (impl stashed) | 2 fail / 3 pass -> `before-fail.txt` |
| After fix | same command | 5 pass / 0 fail -> `after-pass.txt` |
| Full feature suite | `bun test packages/omo-opencode/src/features/tui-sidebar/` | 59 pass / 0 fail |
| Typecheck | `bun run typecheck` (tsgo root + script + all packages) | clean |

## Why this is enough

The bug is a data-model defect: the roster rows handed to the idle view contained
disabled agents. The regression tests pin the exact data-model contract
(`resolveRoster()` output) at the same seam the issue reproduces through; the render
layer consumes these rows verbatim. Full tui-sidebar suite + repo typecheck cover the
blast radius of the touched file (sole consumer is the sidebar idle view).

## QA scope note

Change surface is one pure resolver function plus its co-located test; no hook, tool,
agent registration, config schema, MCP, CLI command, or installer changed. Live
opencode driving was not repeated because the observable behavior is fully determined
by `resolveRoster()` output, which is pinned by the failing-first tests above.

## What was omitted

No secrets, tokens, or env dumps appear in captured output; test logs contain only
tmp-dir paths under `/tmp/omo-tui-roster-*`.
