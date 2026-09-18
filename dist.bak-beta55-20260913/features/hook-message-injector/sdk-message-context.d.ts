import { type OpencodeClient } from "./sdk-message-lookup";
import type { StoredMessage } from "./types";
export declare function findMessageContextFromSDK(client: OpencodeClient, sessionID: string): Promise<{
    prevMessage: StoredMessage | null;
    firstMessageAgent: string | null;
}>;
