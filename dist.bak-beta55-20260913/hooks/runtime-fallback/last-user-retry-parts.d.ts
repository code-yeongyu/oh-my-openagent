type RetryPart = {
    type: "text";
    text: string;
};
export type LastUserRetryPayload = {
    retryParts: RetryPart[];
    system?: string;
    tools?: Record<string, boolean>;
};
export declare function getLastUserRetryParts(messagesResponse: unknown, sessionID?: string): RetryPart[];
export declare function getLastUserRetryPayload(messagesResponse: unknown, sessionID?: string): LastUserRetryPayload;
export {};
