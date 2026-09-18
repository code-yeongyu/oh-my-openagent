import type { ExecutorContext } from "./executor-types";
import type { AgentInfo } from "./subagent-discovery";
import type { ResolvedSubagentModel } from "./subagent-resolution-types";
export declare function resolveSubagentModel(agentToUse: string, matchedAgent: AgentInfo, executorCtx: ExecutorContext): Promise<ResolvedSubagentModel>;
