# Explore child x_search diagnosis

The leak was in the curated-agent rule-to-child-options mapping, not in the shared-tool copy itself.

- `packages/senpi-task/src/agents/tools.ts:38-43` implements `normalizeToolRules`: array entries are normalized into ordered `AgentToolRule` values. `tools.ts:69-80` preserves an explicit `{ pattern, allow: false }` as a deny rule, and `tools.ts:61-66` makes matching last-rule-wins through `resolveToolRule`.
- `packages/senpi-task/src/agents/resolve-agent.ts:201-204` previously built `toolAllowlist` by retaining only literal, non-wildcard rules with `allow: true`. It discarded false rules entirely. It separately forwarded only `definition.disallowedTools` at `resolve-agent.ts:206-213` as `toolDenylist`; curated `tools` rules were never included in that denylist.
- `packages/senpi-task/src/manager/manager-helpers.ts:43-46` persists resolved persona lists as `tool_allow` and `tool_deny`; its child-spec conversion at `manager-helpers.ts:90-93` restores them as `toolAllowlist` and `toolDenylist`. The runner forwards those fields at `packages/senpi-task/src/manager/runner.ts:102-105`.
- `packages/senpi-task/src/runners/in-process/child-options.ts:78-85` merges the shared parent tools and replaces bash for curated read-only agents. `child-options.ts:99-100` maps `toolAllowlist` to senpi `tools` and `toolDenylist` to senpi `excludeTools`.
- `packages/senpi-task/src/runners/in-process/shared-tool-filter.ts:12-25` copies parent `x_search` into the child custom-tool set and changes search exposure to direct exposure. Because it does not inspect curated definitions, x_search remained available whenever the resolved child spec had no denylist entry.

Before the fix, explore had no x_search rule (`packages/senpi-task/src/agents/builtin/explore.ts`), while librarian explicitly allowed it (`librarian.ts:81`). Therefore explore's missing deny was indistinguishable from no restriction once shared custom tools were merged. The fix adds `{ pattern: "x_search", allow: false }` to explore and updates `agentPersona` to forward literal false tool rules into `toolDenylist`; librarian's true rule remains in `toolAllowlist` and has no deny entry.
