/**
 * Agent tool restrictions for session.prompt calls.
 * OpenCode SDK's session.prompt `tools` parameter expects boolean values.
 * true = tool allowed, false = tool denied.
 */
export declare function getAgentToolRestrictions(agentName: string): Record<string, boolean>;
export declare function hasAgentToolRestrictions(agentName: string): boolean;
