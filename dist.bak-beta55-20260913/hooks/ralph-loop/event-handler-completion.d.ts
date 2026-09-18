import type { PluginInput } from "@opencode-ai/plugin";
import type { RalphLoopState } from "./types";
import type { RalphLoopEventHandlerOptions } from "./event-handler-types";
export declare function handleCompletionIfDetected(ctx: PluginInput, options: RalphLoopEventHandlerOptions, input: {
    readonly sessionID: string;
    readonly state: RalphLoopState;
    readonly verificationSessionID: string | undefined;
    readonly runtimeErrorRetriedSessions: Map<string, number>;
}): Promise<boolean>;
