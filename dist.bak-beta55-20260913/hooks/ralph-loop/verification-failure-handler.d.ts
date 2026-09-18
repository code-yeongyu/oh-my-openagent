import type { PluginInput } from "@opencode-ai/plugin";
import type { IterationCommitExpectation, RalphLoopState } from "./types";
type LoopStateController = {
    clearVerificationState: (sessionID: string, messageCountAtStart?: number) => RalphLoopState | null;
    incrementIteration: (expected?: IterationCommitExpectation) => RalphLoopState | null;
    clear: () => boolean;
};
export declare function handleFailedVerification(ctx: PluginInput, input: {
    state: RalphLoopState;
    directory: string;
    apiTimeoutMs: number;
    loopState: LoopStateController;
}): Promise<boolean>;
export {};
