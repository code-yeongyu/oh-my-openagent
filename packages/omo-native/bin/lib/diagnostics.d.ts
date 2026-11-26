// Types for diagnostics.js, which the SDK root's loader imports across the package boundary: omo-ai ships the core as
// plain JS so the launcher loads it with no build step. Each implementation is annotated with these same contract types
// in its own module (diagnostics-run.js, model-chains.js, diagnostics-repairs.js), so a drift fails typecheck there.
import type { DiagnosticsCalls } from "./diagnostics-contract"

export declare const run: DiagnosticsCalls["run"]
export declare const models: DiagnosticsCalls["models"]
export declare const fixReflectionLock: DiagnosticsCalls["fixReflectionLock"]
export declare const reapStaleEngines: DiagnosticsCalls["reapStaleEngines"]
