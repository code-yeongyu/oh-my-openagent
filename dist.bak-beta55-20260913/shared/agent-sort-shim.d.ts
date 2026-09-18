/**
 * Agent sort shim.
 *
 * OpenCode 1.4.x ignores the agent `order` field (sst/opencode#19127) and
 * sorts the agent list by `agent.name` via Remeda `sortBy(x => x.name, "asc")`
 * at packages/opencode/src/agent/agent.ts. Without intervention, core agents
 * collapse into name order, which can invert the default sisyphus -> hephaestus
 * -> prometheus -> atlas order or a user's configured `agent_order`.
 *
 * Earlier attempts to bias the sort key with invisible characters (ZWSP,
 * U+2060 WORD JOINER, U+00AD SOFT HYPHEN, ANSI escape) caused visible-gap
 * and column-truncation regressions in the TUI status bar (#3259, #3238).
 *
 * This shim is the narrowly-scoped alternative from PR #3267 with the Cubic
 * P1 mitigations applied:
 *   1. `isAgentArray` rejects any array element that is null, non-object, or
 *      lacks a string `name`, eliminating the throw-on-mixed-array failure
 *      mode that closed the original PR.
 *   2. The activation predicate requires >= 2 elements whose `.name` is ranked
 *      by the active agent order, so unrelated `.sort()` and `.toSorted()` calls
 *      (string arrays, number arrays, generic objects) execute native behavior
 *      unchanged.
 *
 * Remove this shim once OpenCode honors the agent `order` field
 * (sst/opencode#19127).
 */
export declare function setAgentSortOrder(agentOrder: readonly string[] | undefined): void;
export declare function setDefaultAgentForSort(agentName: string | undefined): void;
export declare function installAgentSortShim(): void;
