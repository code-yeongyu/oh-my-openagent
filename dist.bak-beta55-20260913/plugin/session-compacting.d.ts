import type { Hooks } from "@opencode-ai/plugin";
type SessionCompactingHook = NonNullable<Hooks["experimental.session.compacting"]>;
export type CompactionAutocontinueInput = {
    sessionID: string;
    agent?: string;
    model?: unknown;
    provider?: unknown;
    message?: unknown;
    overflow?: boolean;
};
export type CompactionAutocontinueOutput = {
    enabled: boolean;
};
export type CompactionAutocontinueHook = (input: CompactionAutocontinueInput, output: CompactionAutocontinueOutput) => Promise<void>;
type CompactionAutocontinueHandlerOptions = {
    readonly duplicateGuardMs?: number;
};
type CompactionHookDependencies = {
    compactionContextInjector?: {
        capture?: (sessionID: string) => Promise<void>;
        inject?: (sessionID: string) => string;
        restore?: (sessionID: string) => Promise<boolean>;
    } | null;
    compactionTodoPreserver?: {
        capture?: (sessionID: string) => Promise<void>;
        restore?: (sessionID: string) => Promise<void>;
    } | null;
    claudeCodeHooks?: {
        "experimental.session.compacting"?: SessionCompactingHook;
    } | null;
};
export declare function createSessionCompactingHandler(hooks: CompactionHookDependencies): SessionCompactingHook;
export declare function createCompactionAutocontinueHandler(hooks: CompactionHookDependencies, options?: CompactionAutocontinueHandlerOptions): CompactionAutocontinueHook;
export {};
