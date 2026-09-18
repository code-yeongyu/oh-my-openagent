import type { OpencodeClient } from "./types";
import type { DelegatedModelConfig } from "../../shared/model-resolution-types";
export declare function createSyncSession(client: OpencodeClient, input: {
    parentSessionID: string;
    agentToUse: string;
    description: string;
    defaultDirectory: string;
    categoryModel?: DelegatedModelConfig;
}): Promise<{
    ok: true;
    sessionID: string;
    parentDirectory: string;
} | {
    ok: false;
    error: string;
}>;
