import type { HookDeps } from "./types";
export declare function createStaleSessionCleanup(deps: HookDeps, clearSessionFallbackTimeout: (sessionID: string) => void): () => void;
