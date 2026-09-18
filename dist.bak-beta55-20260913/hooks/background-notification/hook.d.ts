import type { BackgroundManager } from "../../features/background-agent";
interface Event {
    type: string;
    properties?: Record<string, unknown>;
}
interface EventInput {
    event: Event;
}
interface ChatMessageInput {
    sessionID: string;
}
interface ChatMessageOutput {
    parts: Array<{
        type: string;
        text?: string;
        [key: string]: unknown;
    }>;
}
export declare function createBackgroundNotificationHook(manager: BackgroundManager): {
    "chat.message": (input: ChatMessageInput, output: ChatMessageOutput) => Promise<void>;
    event: ({ event }: EventInput) => Promise<void>;
};
export {};
