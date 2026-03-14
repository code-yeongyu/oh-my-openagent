import type { StoredMessage } from "../hook-message-injector";
type SessionMessage = {
    info?: {
        agent?: string;
        model?: {
            providerID?: string;
            modelID?: string;
            variant?: string;
        };
        providerID?: string;
        modelID?: string;
        tools?: StoredMessage["tools"];
    };
};
export declare function isCompactionAgent(agent: string | undefined): boolean;
export declare function resolvePromptContextFromSessionMessages(messages: SessionMessage[], sessionID?: string): StoredMessage | null;
export declare function findNearestMessageExcludingCompaction(messageDir: string, sessionID?: string): StoredMessage | null;
export {};
