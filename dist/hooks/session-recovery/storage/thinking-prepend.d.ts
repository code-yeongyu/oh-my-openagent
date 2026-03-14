import type { PluginInput } from "@opencode-ai/plugin";
type OpencodeClient = PluginInput["client"];
export declare function prependThinkingPart(sessionID: string, messageID: string): boolean;
export declare function prependThinkingPartAsync(client: OpencodeClient, sessionID: string, messageID: string): Promise<boolean>;
export {};
