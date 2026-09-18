/**
 * Default source of truth for core agent ordering.
 * The default order is: sisyphus → hephaestus → prometheus → atlas.
 *
 * User config may override the runtime order through `agent_order`; missing
 * core agents still fall back to this default order. Do not reintroduce sort
 * key prefixes or a second ordering constant.
 *
 * See: src/plugin-handlers/AGENTS.md for architectural context.
 */
export declare const CANONICAL_CORE_AGENT_ORDER: readonly ["sisyphus", "hephaestus", "prometheus", "atlas"];
export declare function reorderAgentsByPriority(agents: Record<string, unknown>, agentOrder?: readonly string[]): Record<string, unknown>;
