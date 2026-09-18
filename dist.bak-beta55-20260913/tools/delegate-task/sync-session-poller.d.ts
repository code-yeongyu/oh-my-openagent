import type { ToolContextWithMetadata, OpencodeClient } from "./types";
export { isSessionComplete } from "./sync-session-turns";
export declare function pollSyncSession(ctx: ToolContextWithMetadata, client: OpencodeClient, input: {
    sessionID: string;
    agentToUse: string;
    toastManager: {
        removeTask: (id: string) => void;
    } | null | undefined;
    taskId: string | undefined;
    anchorMessageCount?: number;
    anchorMessageID?: string;
    maxAssistantTurns?: number;
    hasActiveChildBackgroundTasks?: (sessionID: string) => boolean;
    hasPendingParentWake?: (sessionID: string) => boolean;
    childWakeGraceMs?: number;
}, timeoutMs?: number): Promise<string | null>;
