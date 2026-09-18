import type { OhMyOpenCodeConfig } from "../config";
import { type ContextLimitModelCacheState } from "../shared/context-limit-resolver";
import type { CachedCompactionState, PreemptiveCompactionContext } from "./preemptive-compaction-types";
export declare function runPreemptiveCompactionIfNeeded(args: {
    ctx: PreemptiveCompactionContext;
    pluginConfig: OhMyOpenCodeConfig;
    modelCacheState?: ContextLimitModelCacheState;
    sessionID: string;
    tokenCache: Map<string, CachedCompactionState>;
    compactionInProgress: Set<string>;
    compactedSessions: Set<string>;
    lastCompactionTime: Map<string, number>;
}): Promise<void>;
