import type { StoredMessage, ToolPermission } from "./types";
export type OpencodeClient = {
    readonly session: {
        readonly messages: (input: {
            readonly path: {
                readonly id: string;
            };
        }) => Promise<unknown>;
    };
};
export interface SDKMessage {
    readonly id?: string;
    readonly info?: {
        readonly agent?: string;
        readonly model?: {
            readonly providerID?: string;
            readonly modelID?: string;
            readonly variant?: string;
        };
        readonly providerID?: string;
        readonly modelID?: string;
        readonly variant?: string;
        readonly tools?: Record<string, ToolPermission>;
        readonly time?: {
            readonly created?: number;
        };
    };
    readonly parts?: readonly {
        readonly type?: string;
    }[];
}
export declare function fetchSDKMessages(client: OpencodeClient, sessionID: string): Promise<SDKMessage[] | null>;
export declare function findNearestMessageWithFieldsFromMessages(messages: readonly SDKMessage[]): StoredMessage | null;
export declare function findFirstMessageWithAgentFromMessages(messages: readonly SDKMessage[]): string | null;
export declare function findNearestMessageWithFieldsFromSDK(client: OpencodeClient, sessionID: string): Promise<StoredMessage | null>;
export declare function findFirstMessageWithAgentFromSDK(client: OpencodeClient, sessionID: string): Promise<string | null>;
