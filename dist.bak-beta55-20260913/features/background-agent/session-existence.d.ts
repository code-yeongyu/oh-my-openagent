import type { OpencodeClient } from "./opencode-client";
export declare const MIN_SESSION_GONE_POLLS = 3;
export type SessionExistenceStatus = "exists" | "missing" | "unknown";
export declare function checkSessionExistence(client: OpencodeClient, sessionID: string, directory?: string): Promise<SessionExistenceStatus>;
export declare function verifySessionExists(client: OpencodeClient, sessionID: string, directory?: string): Promise<boolean>;
