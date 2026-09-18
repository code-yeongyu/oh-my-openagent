export type ParentWakePromptContext = {
    agent?: string;
    model?: {
        providerID: string;
        modelID: string;
    };
    variant?: string;
    tools?: Record<string, boolean>;
};
export type PendingParentWake = {
    promptContext: ParentWakePromptContext;
    notifications: string[];
    shouldReply: boolean;
    queuedAt?: number;
    dispatchedAt?: number;
    noReplyAdmittedAt?: number;
    toolCallDeferralStartedAt?: number;
    allowEmptyAssistantTurnRetry?: boolean;
    noAssistantOutputRetryCount?: number;
};
export declare function resolveParentWakePromptContext(promptContext: ParentWakePromptContext): ParentWakePromptContext;
export declare function cloneParentWake(wake: PendingParentWake): PendingParentWake;
export declare function isRedundantParentWake(latestWake: PendingParentWake, dispatchedWake: PendingParentWake): boolean;
export declare function mergeParentWakeNotifications(existingNotifications: readonly string[], nextNotification: string): string[];
export declare function isFailureParentWake(wake: PendingParentWake): boolean;
