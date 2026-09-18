import type { PluginInput } from "@opencode-ai/plugin";
import type { RalphLoopState } from "./types";
import type { IterationCommitExpectation } from "./types";
export declare const STUCK_VERIFICATION_TIMEOUT_MS: number;
type LoopStateController = {
    restartAfterFailedVerification: (sessionID: string, messageCountAtStart?: number) => RalphLoopState | null;
    clearVerificationState: (sessionID: string, messageCountAtStart?: number) => RalphLoopState | null;
    incrementIteration: (expected?: IterationCommitExpectation) => RalphLoopState | null;
    clear: () => boolean;
    setVerificationSessionID: (sessionID: string, verificationSessionID: string) => RalphLoopState | null;
};
export declare function handlePendingVerification(ctx: PluginInput, input: {
    sessionID: string;
    state: RalphLoopState;
    verificationSessionID?: string;
    matchesParentSession: boolean;
    matchesVerificationSession: boolean;
    loopState: LoopStateController;
    directory: string;
    apiTimeoutMs: number;
}): Promise<void>;
export {};
