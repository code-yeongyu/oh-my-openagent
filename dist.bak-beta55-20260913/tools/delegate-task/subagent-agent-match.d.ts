import type { ExecutorContext } from "./executor-types";
import type { ResolveSubagentExecutionOptions, SubagentAgentMatch } from "./subagent-resolution-types";
export declare function resolveSubagentAgentMatch(requestedAgent: string, executorCtx: ExecutorContext, options: ResolveSubagentExecutionOptions): Promise<SubagentAgentMatch>;
