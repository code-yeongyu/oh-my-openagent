import type { DelegateTaskArgs } from "./types";
import type { ExecutorContext } from "./executor-types";
import type { ResolveSubagentExecutionOptions, ResolveSubagentExecutionResult } from "./subagent-resolution-types";
export type { ResolveSubagentExecutionOptions, ResolveSubagentExecutionResult };
export declare function resolveSubagentExecution(args: DelegateTaskArgs, executorCtx: ExecutorContext, parentAgent: string | undefined, categoryExamples: string, options?: ResolveSubagentExecutionOptions): Promise<ResolveSubagentExecutionResult>;
