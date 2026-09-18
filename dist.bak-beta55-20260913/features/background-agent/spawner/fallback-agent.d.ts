import type { TaskPromptBody } from "./task-prompt-body";
export declare const FALLBACK_AGENT = "general";
export declare function isAgentNotFoundError(error: unknown): boolean;
export declare function buildFallbackBody(originalBody: TaskPromptBody, fallbackAgent: string, options?: {
    includeTeamToolDenylist?: boolean;
}): TaskPromptBody;
