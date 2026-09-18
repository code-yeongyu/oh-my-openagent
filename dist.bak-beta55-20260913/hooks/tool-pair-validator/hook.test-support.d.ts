import type { MessagesTransformHook } from "./types";
export type TestPart = {
    type: string;
    [key: string]: unknown;
};
export type TestMessage = {
    info: {
        role: "assistant" | "user";
        id?: string;
        sessionID?: string;
    };
    parts: TestPart[];
};
type ToolPartOptions = {
    callID: string;
    status: "pending" | "running" | "completed" | "error";
    tool?: string;
    input?: Record<string, unknown>;
    output?: string;
    error?: string;
    start?: number;
};
/**
 * Mirrors the real OpenCode `ToolPart` shape (`@opencode-ai/sdk`): one part carries
 * the call id AND the state that later becomes the provider's `tool_result`.
 */
export declare function createToolPart(options: ToolPartOptions): TestPart;
export declare function runToolPairValidator(hook: MessagesTransformHook, messages: TestMessage[]): Promise<void>;
export {};
