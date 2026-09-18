import type { PluginInput } from "@opencode-ai/plugin";
import type { ToolExecuteAfterInput, ToolExecuteAfterOutput } from "./types";
export declare function handleDirectWorkToolAfter(input: {
    ctx: PluginInput;
    pendingFilePaths: Map<string, string>;
    pendingPlanSnapshots?: Map<string, string>;
    toolInput: ToolExecuteAfterInput;
    toolOutput: ToolExecuteAfterOutput;
}): Promise<boolean>;
