export interface UserPromptSubmitPayload {
    readonly cwd: string;
    readonly hook_event_name: "UserPromptSubmit";
    readonly model?: string;
    readonly permission_mode?: string;
    readonly prompt: string;
    readonly session_id: string;
    readonly transcript_path?: string | null;
    readonly turn_id?: string;
}
export interface UserPromptSubmitHookOptions {
    readonly includeUltraworkDirective?: boolean;
    readonly ultraworkSkillFilePath?: string | null;
}
export interface PreToolUsePayload {
    readonly cwd: string;
    readonly hook_event_name: "PreToolUse";
    readonly model: string;
    readonly permission_mode: string;
    readonly session_id: string;
    readonly tool_input: unknown;
    readonly tool_name: string;
    readonly tool_use_id: string;
    readonly transcript_path: string | null;
    readonly turn_id: string;
}
export declare function parseUserPromptSubmitPayload(raw: string): UserPromptSubmitPayload | null;
export declare function parsePreToolUsePayload(raw: string): PreToolUsePayload | null;
export declare function applyUserPromptUlwLoopSteering(payload: UserPromptSubmitPayload, options?: UserPromptSubmitHookOptions): Promise<string>;
export declare function applyPreToolUseGoalBudgetGuard(payload: PreToolUsePayload): string;
export declare function runUlwLoopHookCli(stdin: NodeJS.ReadableStream, stdout: NodeJS.WritableStream, options?: UserPromptSubmitHookOptions): Promise<void>;
export declare function runPreToolUseGoalBudgetGuardCli(stdin: NodeJS.ReadableStream, stdout: NodeJS.WritableStream): Promise<void>;
