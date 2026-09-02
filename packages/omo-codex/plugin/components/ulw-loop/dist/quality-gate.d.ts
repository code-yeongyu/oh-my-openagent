import { type UlwLoopToolkitSurface } from "./surface.js";
import type { UlwLoopQualityGate } from "./types.js";
export { classifyExternalAuthorizationBlocker, clearGoalBlockerFields, normalizeBlockerEvidence, sameBlockerOccurrences, } from "./quality-gate-blockers.js";
export interface QualityGateFs {
    readonly existsSync: (path: string) => boolean;
    readonly statSync: (path: string) => {
        readonly size: number;
    };
}
export interface ValidateQualityGateOptions {
    readonly repoRoot?: string;
    readonly fs?: QualityGateFs;
    readonly currentAttemptDir?: string;
    readonly reviewerSurface?: UlwLoopToolkitSurface;
}
export declare function validateQualityGate(input: unknown, opts?: ValidateQualityGateOptions): UlwLoopQualityGate;
