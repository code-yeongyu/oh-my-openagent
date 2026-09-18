export type GrepBackend = "rg" | "grep";
export interface ResolvedCli {
    path: string;
    backend: GrepBackend;
}
export declare const DEFAULT_RG_THREADS = 4;
export declare function resolveGrepCli(): ResolvedCli;
export declare function resolveGrepCliWithAutoInstall(): Promise<ResolvedCli>;
