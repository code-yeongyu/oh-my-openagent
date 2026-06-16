#!/usr/bin/env node
export type ServeStdio = "inherit";
export type CodegraphCommandSource = "bundled" | "env" | "path" | "provisioned";
export interface CodegraphCommandResolution {
    readonly argsPrefix: readonly string[];
    readonly command: string;
    readonly exists: boolean;
    readonly source: CodegraphCommandSource;
}
export interface CodegraphServeProcessOptions {
    readonly env: Record<string, string | undefined>;
    readonly stdio: ServeStdio;
}
export type CodegraphServeProcessRunner = (command: string, args: readonly string[], options: CodegraphServeProcessOptions) => Promise<number>;
export interface CodegraphServeStderr {
    readonly write: (chunk: string) => void;
}
export interface RunCodegraphServeOptions {
    readonly buildEnv?: (options: {
        readonly homeDir: string;
    }) => Record<string, string>;
    readonly env?: Record<string, string | undefined>;
    readonly homeDir?: string;
    readonly resolve?: (options: {
        readonly env: Record<string, string | undefined>;
        readonly homeDir: string;
    }) => CodegraphCommandResolution;
    readonly runProcess?: CodegraphServeProcessRunner;
    readonly stderr?: CodegraphServeStderr;
}
export declare function runCodegraphServe(options?: RunCodegraphServeOptions): Promise<number>;
export declare function runCodegraphServeCli(): Promise<void>;
