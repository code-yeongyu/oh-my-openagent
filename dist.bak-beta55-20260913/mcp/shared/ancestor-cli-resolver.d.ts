import type { RuntimeExecutable, RuntimeExecutableResolver } from "../runtime-executable";
type SourceCandidateAvailabilityInput = {
    readonly root: string;
    readonly sourcePath: string;
    readonly pathExists: (path: string) => boolean;
};
type AncestorCliResolverOptions = {
    readonly startDirectory: string;
    readonly packageRel: string;
    readonly distCliRel: string;
    readonly sourceCliRel: string;
    readonly pathExists: (path: string) => boolean;
    readonly resolveExecutable: RuntimeExecutableResolver;
    readonly isSourceCandidateAvailable?: (input: SourceCandidateAvailabilityInput) => boolean;
};
export type AncestorCliCandidate = {
    readonly command: string[];
    readonly root: string;
    readonly path: string;
    readonly exists: boolean;
    readonly runtimeAvailable: boolean;
};
export declare function resolveJavaScriptRuntime(resolveExecutable: RuntimeExecutableResolver): RuntimeExecutable;
export declare function createAncestorCliCandidates(options: AncestorCliResolverOptions): AncestorCliCandidate[];
export {};
