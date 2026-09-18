import type { OhMyOpenCodeConfig } from "../config";
import type { ContextLimitModelCacheState } from "../shared/context-limit-resolver";
import type { PreemptiveCompactionContext } from "./preemptive-compaction-types";
export declare function createPreemptiveCompactionHook(ctx: PreemptiveCompactionContext, pluginConfig: OhMyOpenCodeConfig, modelCacheState?: ContextLimitModelCacheState): {
    "tool.execute.after": (input: {
        tool: string;
        sessionID: string;
        callID: string;
    }, _output: {
        title: string;
        output: string;
        metadata: unknown;
    }) => Promise<void>;
    event: ({ event }: {
        event: {
            type: string;
            properties?: unknown;
        };
    }) => Promise<void>;
};
