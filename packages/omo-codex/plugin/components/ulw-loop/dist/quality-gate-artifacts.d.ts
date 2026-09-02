import type { ValidateQualityGateOptions } from "./quality-gate.js";
import type { UlwLoopManualQaArtifactKind, UlwLoopManualQaArtifactRef, UlwLoopManualQaSurface } from "./types.js";
export declare function surfaceField(value: unknown, field: string): UlwLoopManualQaSurface;
export declare function kindField(value: unknown, field: string): UlwLoopManualQaArtifactKind;
export declare function artifactCompatible(surface: UlwLoopManualQaSurface, kind: UlwLoopManualQaArtifactKind): boolean;
export declare function checkFile(path: string, field: string, opts?: ValidateQualityGateOptions): void;
export declare function artifactMap(refs: readonly UlwLoopManualQaArtifactRef[]): Map<string, UlwLoopManualQaArtifactRef>;
export declare function parseArtifactRefs(value: unknown, opts?: ValidateQualityGateOptions): readonly UlwLoopManualQaArtifactRef[];
export declare function referencedArtifacts(value: unknown, field: string, byId: ReadonlyMap<string, UlwLoopManualQaArtifactRef>): readonly UlwLoopManualQaArtifactRef[];
