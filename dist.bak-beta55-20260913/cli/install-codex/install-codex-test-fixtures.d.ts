export declare const EXPECTED_OMO_COMPONENT_BINS: readonly [{
    readonly name: "omo";
    readonly target: string;
    readonly kind: "runtime-wrapper";
}, {
    readonly name: "omo-comment-checker";
    readonly target: string;
}, {
    readonly name: "omo-git-bash-hook";
    readonly target: string;
}, {
    readonly name: "omo-lsp";
    readonly target: string;
}, {
    readonly name: "omo-rules";
    readonly target: string;
}, {
    readonly name: "omo-ulw-execute-continuation";
    readonly target: string;
}, {
    readonly name: "omo-telemetry";
    readonly target: string;
}, {
    readonly name: "omo-ulw-loop";
    readonly target: string;
}, {
    readonly name: "omo-ultrawork";
    readonly target: string;
}];
export declare function expectedBinName(name: string): string;
export declare function createRepoWithBuiltComponentBins(input?: {
    readonly includeBundledGitBashMcp?: boolean;
    readonly includeRootCliDist?: boolean;
}): Promise<string>;
