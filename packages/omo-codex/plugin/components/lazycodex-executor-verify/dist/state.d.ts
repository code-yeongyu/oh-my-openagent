import type { HookFileSystem } from "./types.js";
export declare const MAX_ATTEMPTS = 3;
export type AttemptState = {
    readonly attempts: number;
};
export declare function readAttemptState(cwd: string, sessionId: string, agentId: string, fs: HookFileSystem): AttemptState;
export declare function writeAttemptState(cwd: string, sessionId: string, agentId: string, state: AttemptState, fs: HookFileSystem): void;
export declare function clearAttemptState(cwd: string, sessionId: string, agentId: string, fs: HookFileSystem): void;
export declare function getStatePath(cwd: string, sessionId: string, agentId: string): string;
