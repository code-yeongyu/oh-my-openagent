import type { PluginInput } from "@opencode-ai/plugin";
import type { RalphLoopState } from "./types";
import type { RalphLoopEventHandlerOptions } from "./event-handler-types";
export type EventHandlerRuntime = {
    readonly inFlightSessions: Set<string>;
    readonly runtimeErrorRetriedSessions: Map<string, number>;
    readonly recentHandledSyntheticIdleAt: Map<string, number>;
};
export declare function getVerificationSessionID(state: RalphLoopState): string | undefined;
export declare function matchesLoopSession(state: RalphLoopState, sessionID: string, verificationSessionID: string | undefined): {
    readonly parent: boolean;
    readonly verification: boolean;
};
export declare function maxIterationsReached(state: RalphLoopState): boolean;
export declare function handleIdleEvent(ctx: PluginInput, options: RalphLoopEventHandlerOptions, runtime: EventHandlerRuntime, props: Record<string, unknown> | undefined, sessionID: string): Promise<void>;
