export interface MutatedFileInput {
    readonly tool_name?: unknown;
    readonly tool_input?: unknown;
    readonly tool_response?: unknown;
}
export declare function extractMutatedFilePaths(input: MutatedFileInput): string[];
