type BunInstallOutputMode = "inherit" | "pipe";
interface RunBunInstallOptions {
    outputMode?: BunInstallOutputMode;
}
export interface BunInstallResult {
    success: boolean;
    timedOut?: boolean;
    error?: string;
}
export declare function runBunInstall(): Promise<boolean>;
export declare function runBunInstallWithDetails(options?: RunBunInstallOptions): Promise<BunInstallResult>;
export {};
