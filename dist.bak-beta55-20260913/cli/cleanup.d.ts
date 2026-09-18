export type CleanupPlatform = "codex";
export interface CleanupOptions {
    readonly platform?: CleanupPlatform | "opencode" | "both";
    readonly codexHome?: string;
    readonly project?: string;
    readonly json?: boolean;
}
export declare function resolveCleanupPlatform(options: {
    readonly platform?: CleanupOptions["platform"];
}, invocationName?: string | undefined): CleanupOptions["platform"] | undefined;
export declare function cleanup(options: CleanupOptions): Promise<number>;
