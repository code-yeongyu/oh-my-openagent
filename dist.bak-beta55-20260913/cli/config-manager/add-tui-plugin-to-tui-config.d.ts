export type EnsureTuiPluginEntryResult = {
    readonly changed: boolean;
    readonly reason: string;
};
export declare function ensureTuiPluginEntry(opts?: {
    configDir?: string;
}): EnsureTuiPluginEntryResult;
