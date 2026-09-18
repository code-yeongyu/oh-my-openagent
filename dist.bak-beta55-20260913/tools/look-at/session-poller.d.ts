import type { createOpencodeClient } from "@opencode-ai/sdk";
import { type AssistantOutcome } from "./assistant-message-extractor";
type Client = ReturnType<typeof createOpencodeClient>;
export interface PollOptions {
    pollIntervalMs?: number;
    timeoutMs?: number;
    abortSignal?: AbortSignal;
    allowStableIdleWithoutActivity?: boolean;
    allowEmptyStableIdleWithoutActivity?: boolean;
}
export declare function waitForLookAtSessionResult(client: Client, sessionID: string, options?: PollOptions): Promise<{
    messages: unknown[];
    outcome: AssistantOutcome;
    statusType: string | null;
}>;
export {};
