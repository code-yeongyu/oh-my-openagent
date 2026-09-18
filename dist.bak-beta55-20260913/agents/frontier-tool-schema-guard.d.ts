import type { AgentConfig } from "@opencode-ai/sdk";
export declare function getFrontierToolSchemaPermission(model: string): Record<string, "deny">;
export declare function applyFrontierToolSchemaPermission(permission: AgentConfig["permission"] | undefined, model: string, explicitPermission?: AgentConfig["permission"], explicitTools?: Record<string, boolean>): AgentConfig["permission"] | undefined;
