import type { DelegateTaskArgs } from "./types";
import type { ResolveSubagentExecutionOptions, SubagentRequestPreflight } from "./subagent-resolution-types";
export declare function validateSubagentRequest(args: DelegateTaskArgs, parentAgent: string | undefined, categoryExamples: string, options: ResolveSubagentExecutionOptions): SubagentRequestPreflight;
