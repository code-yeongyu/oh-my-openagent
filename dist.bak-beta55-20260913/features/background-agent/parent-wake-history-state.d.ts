import type { PendingParentWake } from "./parent-wake-dedupe";
export declare function latestAssistantTurnIsCompletedEmptyNoProgress(messages: readonly unknown[]): boolean;
export declare function latestAssistantTurnHasToolBlock(messages: readonly unknown[]): boolean;
export declare function latestAssistantTurnHasFreshToolActivity(messages: readonly unknown[], now: number, maxAgeMs: number): boolean;
export declare function latestAssistantTurnHasStaleUnknownSubstantiveOutput(messages: readonly unknown[], now: number, maxAgeMs: number): boolean;
export declare function createEmptyAssistantTurnRetryDedupeKey(wake: PendingParentWake): string;
