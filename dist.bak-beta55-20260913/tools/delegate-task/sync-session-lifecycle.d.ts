import type { ExecutorContext, ParentContext } from "./executor-types";
import type { DelegatedModelConfig, DelegateTaskArgs } from "./types";
export declare function registerSyncSessionSideEffects(input: {
    readonly args: DelegateTaskArgs;
    readonly executorCtx: ExecutorContext;
    readonly sessionID: string;
    readonly parentContext: ParentContext;
    readonly agentToUse: string;
    readonly categoryModel: DelegatedModelConfig | undefined;
    readonly fallbackChain: import("../../shared/model-requirements").FallbackEntry[] | undefined;
    readonly systemContent: string | undefined;
}): Promise<void>;
export declare function cleanupSyncSessionSideEffects(sessionID: string, executorCtx: Pick<ExecutorContext, "modelFallbackControllerAccessor">): void;
