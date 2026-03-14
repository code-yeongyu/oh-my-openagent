import type { CheckResult, SystemInfo } from "../types";
export declare function gatherSystemInfo(): Promise<SystemInfo>;
export declare function checkSystem(): Promise<CheckResult>;
