import type { Message, Part } from "@opencode-ai/sdk";
export declare const BTW_PARENT_CONTEXT_MAX_BYTES: number;
export declare const BTW_PARENT_CONTEXT_MAX_MESSAGES = 64;
type MessageWithParts = {
    info: Message;
    parts: Part[];
};
export declare function boundBtwParentContext(messages: MessageWithParts[]): MessageWithParts[];
export {};
