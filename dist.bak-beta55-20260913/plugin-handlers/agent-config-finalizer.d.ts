import type { ApplyAgentConfigParams } from "./agent-config-types";
export declare function finalizeAgentConfig(params: Pick<ApplyAgentConfigParams, "config" | "pluginConfig"> & {
    configuredDefaultAgent: string | undefined;
}): Record<string, unknown>;
