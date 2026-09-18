import type { ModelFallbackInfo } from "../../features/task-toast-manager/types";
import type { FallbackEntry } from "../../shared/model-requirements";
import type { ExecutorContext, ParentContext } from "./executor-types";
import { type SyncTaskDeps } from "./sync-task-deps";
import type { DelegatedModelConfig, DelegateTaskArgs, ToolContextWithMetadata } from "./types";
export declare function executeSyncTask(args: DelegateTaskArgs, ctx: ToolContextWithMetadata, executorCtx: ExecutorContext, parentContext: ParentContext, agentToUse: string, categoryModel: DelegatedModelConfig | undefined, systemContent: string | undefined, modelInfo?: ModelFallbackInfo, fallbackChain?: FallbackEntry[], deps?: SyncTaskDeps): Promise<string>;
