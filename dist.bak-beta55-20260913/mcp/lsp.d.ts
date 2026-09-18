import { type RuntimeExecutableResolver } from "./runtime-executable";
type LspMcpConfigOptions = {
    readonly cwd?: string;
    readonly moduleUrl?: string;
    readonly exists?: (path: string) => boolean;
    readonly resolveExecutable?: RuntimeExecutableResolver;
};
export type LocalMcpConfig = {
    type: "local";
    command: string[];
    enabled: boolean;
    cwd?: string;
    environment?: Record<string, string>;
};
export declare function createLspMcpConfig(options?: LspMcpConfigOptions): LocalMcpConfig;
export {};
