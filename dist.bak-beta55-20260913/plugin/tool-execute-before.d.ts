import type { PluginContext } from "./types";
import type { CreatedHooks } from "../create-hooks";
import type { BackgroundManager } from "../features/background-agent";
export declare function createToolExecuteBeforeHandler(args: {
    ctx: PluginContext;
    hooks: CreatedHooks;
    backgroundManager?: Pick<BackgroundManager, "hasActiveChildTasks" | "hasPendingParentWake">;
}): (input: {
    tool: string;
    sessionID: string;
    callID: string;
}, output: {
    args: Record<string, unknown>;
}) => Promise<void>;
