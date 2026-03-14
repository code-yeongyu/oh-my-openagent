/**
 * Caches tool_input from PreToolUse for PostToolUse
 */
export declare function cacheToolInput(sessionId: string, toolName: string, invocationId: string, toolInput: Record<string, unknown>): void;
export declare function getToolInput(sessionId: string, toolName: string, invocationId: string): Record<string, unknown> | null;
