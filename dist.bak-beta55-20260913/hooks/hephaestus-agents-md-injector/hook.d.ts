import type { AgentsMdCache } from "@oh-my-opencode/rules-engine";
import type { PluginInput } from "@opencode-ai/plugin";
import type { ContextLimitModelCacheState } from "../../shared/context-limit-resolver";
type ChatMessageInput = {
    readonly sessionID: string;
    readonly agent?: string;
};
type OutputPart = {
    readonly type: string;
    text?: string;
    readonly [key: string]: unknown;
};
type ChatMessageOutput = {
    readonly message: Record<string, unknown>;
    readonly parts: OutputPart[];
};
type EventInput = {
    readonly event: {
        readonly type: string;
        readonly properties?: unknown;
    };
};
type AgentsMdTruncator = {
    readonly truncate: (sessionID: string, output: string) => Promise<{
        readonly result: string;
        readonly truncated: boolean;
    }>;
};
type HephaestusAgentsMdInjectorOptions = {
    readonly agentsMdCache?: AgentsMdCache;
    readonly truncator?: AgentsMdTruncator;
};
export declare function createHephaestusAgentsMdInjectorHook(ctx: PluginInput, modelCacheState?: ContextLimitModelCacheState, options?: HephaestusAgentsMdInjectorOptions): {
    "chat.message": (input: ChatMessageInput, output: ChatMessageOutput) => Promise<void>;
    event: ({ event }: EventInput) => Promise<void>;
};
export {};
