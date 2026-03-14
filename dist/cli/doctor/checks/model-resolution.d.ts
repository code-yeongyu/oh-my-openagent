import type { CheckResult } from "../types";
import type { ModelResolutionInfo, OmoConfig } from "./model-resolution-types";
export declare function getModelResolutionInfo(): ModelResolutionInfo;
export declare function getModelResolutionInfoWithOverrides(config: OmoConfig): ModelResolutionInfo;
export declare function checkModels(): Promise<CheckResult>;
export declare const checkModelResolution: typeof checkModels;
