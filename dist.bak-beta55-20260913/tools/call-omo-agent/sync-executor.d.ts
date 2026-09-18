import type { PluginInput } from "@opencode-ai/plugin";
import type { FallbackEntry } from "../../shared/model-requirements";
import type { DelegatedModelConfig } from "../../shared/model-resolution-types";
import { waitForCompletion } from "./completion-poller";
import { processMessages } from "./message-processor";
import { createOrGetSession } from "./session-creator";
import type { CallOmoAgentArgs } from "./types";
type ExecuteSyncDeps = {
    createOrGetSession: typeof createOrGetSession;
    waitForCompletion: typeof waitForCompletion;
    processMessages: typeof processMessages;
    setSessionFallbackChain: (sessionID: string, fallbackChain: FallbackEntry[] | undefined) => void;
    clearSessionFallbackChain: (sessionID: string) => void;
};
type SpawnReservation = {
    commit: () => number;
    rollback: () => void;
};
export declare function executeSync(args: CallOmoAgentArgs, toolContext: {
    sessionID: string;
    messageID: string;
    agent: string;
    abort: AbortSignal;
    metadata?: (input: {
        title?: string;
        metadata?: Record<string, unknown>;
    }) => void | Promise<void>;
}, ctx: PluginInput, deps?: ExecuteSyncDeps, fallbackChain?: FallbackEntry[], spawnReservation?: SpawnReservation, model?: DelegatedModelConfig): Promise<string>;
export {};
