import type { DynamicTruncator, RuleToInject, ToolExecuteOutput } from "./injection-types";
export declare function appendInjectedRulesToOutput(output: ToolExecuteOutput, rules: RuleToInject[], sessionID: string, truncator: DynamicTruncator): Promise<void>;
