import { replaceEmptyTextPartsAsync, findMessagesWithEmptyTextPartsFromSDK } from "./storage/empty-text";
import { injectTextPartAsync } from "./storage/text-part-injector";
import type { Client } from "./client";
export declare function fixEmptyMessagesWithSDK(params: {
    sessionID: string;
    client: Client;
    placeholderText: string;
    messageIndex?: number;
}, storage?: {
    replaceEmptyTextPartsAsync: typeof replaceEmptyTextPartsAsync;
    findMessagesWithEmptyTextPartsFromSDK: typeof findMessagesWithEmptyTextPartsFromSDK;
    injectTextPartAsync: typeof injectTextPartAsync;
}): Promise<{
    fixed: boolean;
    fixedMessageIds: string[];
    scannedEmptyCount: number;
}>;
