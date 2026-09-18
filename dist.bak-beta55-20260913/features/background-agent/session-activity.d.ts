import type { OpencodeClient } from "./opencode-client";
export type SessionActivityLookup = {
    readonly type: "activity";
    readonly activity: Date;
} | {
    readonly type: "missing";
} | {
    readonly type: "unavailable";
};
export type SessionActivityResolver = (sessionID: string) => Promise<SessionActivityLookup>;
export declare function extractSessionActivityDate(sessionInfo: unknown): Date | undefined;
export declare function getSessionActivityFromClient(client: OpencodeClient, sessionID: string, directory?: string): Promise<SessionActivityLookup>;
