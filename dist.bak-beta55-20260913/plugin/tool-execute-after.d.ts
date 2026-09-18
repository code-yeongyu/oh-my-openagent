import type { CreatedHooks } from "../create-hooks";
import { log as defaultLog } from "../shared/logger";
import type { PluginContext } from "./types";
type ToolExecuteAfterInput = {
    readonly tool: string;
    readonly sessionID: string;
    readonly callID?: string;
    readonly callId?: string;
    readonly call_id?: string;
    readonly args?: Record<string, unknown>;
};
type ToolExecuteAfterOutput = {
    title: string;
    output: string;
    metadata: Record<string, unknown>;
};
export declare function createToolExecuteAfterHandler(args: {
    ctx: PluginContext;
    hooks: CreatedHooks;
    log?: typeof defaultLog;
}): (input: ToolExecuteAfterInput, output: ToolExecuteAfterOutput | undefined) => Promise<void>;
export {};
