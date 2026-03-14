import type { ToolDefinition } from "@opencode-ai/plugin";
export declare function normalizeToolArgSchemas<TDefinition extends Pick<ToolDefinition, "args">>(toolDefinition: TDefinition): TDefinition;
