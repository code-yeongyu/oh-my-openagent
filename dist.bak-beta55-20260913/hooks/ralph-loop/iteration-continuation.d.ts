import type { PluginInput } from "@opencode-ai/plugin";
import type { RalphLoopState } from "./types";
type ContinuationOptions = {
    directory: string;
    apiTimeoutMs: number;
    idleSettleMs: number;
    previousSessionID: string;
    loopState: {
        setSessionID: (sessionID: string) => RalphLoopState | null;
    };
};
export type ContinuationResult = {
    status: "dispatched";
    sessionID: string;
} | {
    status: "dispatch_deferred";
    reason: "active" | "reserved";
} | {
    status: "session_creation_rejected";
} | {
    status: "dispatch_rejected";
    error: unknown;
};
export declare function continueIteration(ctx: PluginInput, state: RalphLoopState, options: ContinuationOptions): Promise<ContinuationResult>;
export {};
