import type { MessageWithParts, TransformMessageInfo, UnpairedToolPart } from "./types";
export declare const INTERRUPTED_TOOL_ERROR = "[Tool execution was interrupted before it produced output]";
export declare function getMessageSessionID(message: TransformMessageInfo): string | undefined;
export declare function repairUnpairedToolParts(message: MessageWithParts): UnpairedToolPart[];
export declare function diagnoseSubAgentUnpairedToolParts(message: MessageWithParts, sessionID: string): void;
