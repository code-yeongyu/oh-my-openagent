export type RetryPromptPart = {
    type: "text";
    text: string;
    id?: string;
};
export declare function resolveOriginalUserRetryMetadata(messagesResponse: unknown): {
    messageID?: string;
    parts: RetryPromptPart[];
};
