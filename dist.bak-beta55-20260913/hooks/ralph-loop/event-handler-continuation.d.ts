import type { PluginInput } from "@opencode-ai/plugin";
import type { RalphLoopState } from "./types";
import type { RalphLoopEventHandlerOptions } from "./event-handler-types";
type ContinueSettledIterationInput = {
    readonly sessionID: string;
    readonly state: RalphLoopState;
    readonly runtimeErrorRetriedSessions: Map<string, number>;
    readonly afterRuntimeError: boolean;
};
export declare function stopIfLatestAssistantMadeNoProgress(ctx: PluginInput, options: RalphLoopEventHandlerOptions, input: {
    readonly sessionID: string;
    readonly state: RalphLoopState;
    readonly afterRuntimeError?: boolean;
}): Promise<boolean>;
export declare function continueSettledIteration(ctx: PluginInput, options: RalphLoopEventHandlerOptions, input: ContinueSettledIterationInput): Promise<void>;
export {};
