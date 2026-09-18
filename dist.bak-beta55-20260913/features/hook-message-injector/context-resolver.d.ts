import type { OpencodeClient } from "./sdk-message-lookup";
import type { StoredMessage } from "./types";
export declare function resolveMessageContext(sessionID: string, client: OpencodeClient, messageDir: string | null): Promise<{
    prevMessage: StoredMessage | null;
    firstMessageAgent: string | null;
}>;
