import type { DelegateTaskArgs, ToolContextWithMetadata } from "./types";
import type { ExecutorContext, ParentContext } from "./executor-types";
import { type SyncContinuationDeps } from "./sync-continuation-deps";
export declare function executeSyncContinuation(args: DelegateTaskArgs, ctx: ToolContextWithMetadata, executorCtx: ExecutorContext, parentContext: ParentContext, deps?: SyncContinuationDeps, systemContent?: string): Promise<string>;
