type TextPart = {
    type?: string;
    text?: string;
};
type MessageInfo = {
    id?: string;
    role?: string;
    error?: unknown;
    model?: {
        providerID?: string;
        modelID?: string;
    };
    providerID?: string;
    modelID?: string;
};
export type SessionMessage = {
    info?: MessageInfo;
    parts?: TextPart[];
};
export declare function getLastAssistantMessage(messages: SessionMessage[]): SessionMessage | null;
export declare function extractAssistantText(message: SessionMessage): string;
export declare function isGptAssistantMessage(message: SessionMessage): boolean;
export {};
