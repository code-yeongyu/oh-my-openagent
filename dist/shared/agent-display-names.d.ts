/**
 * Agent config keys to display names mapping.
 * Config keys are lowercase (e.g., "sisyphus", "atlas").
 * Display names include suffixes for UI/logs (e.g., "Sisyphus (Ultraworker)").
 */
export declare const AGENT_DISPLAY_NAMES: Record<string, string>;
/**
 * Get display name for an agent config key.
 * Uses case-insensitive lookup for backward compatibility.
 * Returns original key if not found.
 */
export declare function getAgentDisplayName(configKey: string): string;
/**
 * Resolve an agent name (display name or config key) to its lowercase config key.
 * "Atlas (Plan Executor)" → "atlas", "atlas" → "atlas", "unknown" → "unknown"
 */
export declare function getAgentConfigKey(agentName: string): string;
