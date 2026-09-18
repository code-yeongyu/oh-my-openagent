import type { PendingParentWake } from "./parent-wake-dedupe";
import type { ParentWakeSessionMessage } from "./parent-wake-session-message";
export type ToolWaitDeferralDecision = {
    readonly defer: boolean;
    readonly skipPromptGateToolStateCheck: boolean;
};
export declare function parentWakeUserMessageIsInProgress(input: {
    readonly messages: readonly ParentWakeSessionMessage[] | undefined;
    readonly windowMs: number;
    readonly now?: number;
}): boolean;
export declare function getParentWakeSessionHistoryDeferralDecision(input: {
    readonly sessionID: string;
    readonly messages: readonly ParentWakeSessionMessage[] | undefined;
    readonly wake: PendingParentWake;
    readonly toolCallDeferMaxMs: number;
    readonly now?: number;
}): ToolWaitDeferralDecision;
export declare function hasRecordedParentWakePromptMessage(input: {
    readonly messages: readonly ParentWakeSessionMessage[] | undefined;
    readonly wake: PendingParentWake;
    readonly acceptedMessageSkewMs: number;
}): boolean;
export declare function hasAssistantOutputAfterParentWakeAdmission(input: {
    readonly messages: readonly ParentWakeSessionMessage[] | undefined;
    readonly wake: PendingParentWake;
}): boolean;
export declare function hasAssistantOrToolOutputAfterParentWake(input: {
    readonly messages: readonly ParentWakeSessionMessage[] | undefined;
    readonly wake: PendingParentWake;
}): boolean;
