import type { CheckResult, DoctorIssue, ToolsSummary } from "../framework/types";
export declare function gatherToolsSummary(): Promise<ToolsSummary>;
export declare function buildToolIssues(summary: ToolsSummary): DoctorIssue[];
export declare function checkTools(): Promise<CheckResult>;
