import type { PromptMessagesQuery } from "@oh-my-opencode/utils/prompt-async-gate/types";
import type { PendingParentWake } from "./parent-wake-dedupe";
import { type ToolWaitDeferralDecision } from "./parent-wake-session-history";
type ParentWakeSessionInspectorClient = {
    readonly session: {
        readonly messages: (input: {
            readonly path: {
                readonly id: string;
            };
            readonly query: PromptMessagesQuery;
        }) => Promise<unknown>;
    };
};
type ParentWakeSessionInspectorOptions = {
    readonly directory: string;
    readonly acceptedMessageSkewMs: number;
    readonly toolCallDeferMaxMs: number;
    readonly userMessageInProgressWindowMs: number;
    readonly parentSessionActivityInProgressWindowMs?: number;
};
export declare class ParentWakeSessionInspector {
    private readonly client;
    private readonly options;
    private recentParentSessionActivity;
    constructor(client: ParentWakeSessionInspectorClient, options: ParentWakeSessionInspectorOptions);
    recordActivity(sessionID: string): void;
    hasRecentActivity(sessionID: string): boolean;
    isUserMessageInProgress(sessionID: string): Promise<boolean>;
    shouldDeferForHistory(sessionID: string, wake: PendingParentWake): Promise<ToolWaitDeferralDecision>;
    hasRecordedPromptMessageAfterDispatchedWake(sessionID: string, wake: PendingParentWake): Promise<boolean>;
    hasAssistantOutputAfterAdmittedWake(sessionID: string, wake: PendingParentWake): Promise<boolean>;
    hasAssistantOrToolOutputAfterDispatchedWake(sessionID: string, wake: PendingParentWake): Promise<boolean>;
    shutdown(): void;
    private loadMessages;
}
export {};
