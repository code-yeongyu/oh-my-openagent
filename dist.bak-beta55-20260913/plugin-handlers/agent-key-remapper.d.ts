type AgentOverridesMap = Record<string, {
    displayName?: string;
} | undefined>;
export declare function remapAgentKeysToDisplayNames(agents: Record<string, unknown>, overrides?: AgentOverridesMap): Record<string, unknown>;
export {};
