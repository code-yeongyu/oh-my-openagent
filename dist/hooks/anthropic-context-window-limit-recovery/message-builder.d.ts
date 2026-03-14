import type { PluginInput } from "@opencode-ai/plugin";
export declare const PLACEHOLDER_TEXT = "[user interrupted]";
type OpencodeClient = PluginInput["client"];
export declare function sanitizeEmptyMessagesBeforeSummarize(sessionID: string, client?: OpencodeClient): Promise<number>;
export declare function formatBytes(bytes: number): string;
export declare function getLastAssistant(sessionID: string, client: any, directory: string): Promise<Record<string, unknown> | null>;
export {};
