import type { PluginEntryInfo } from "./plugin-entry";
export interface SyncResult {
    synced: boolean;
    error: "file_not_found" | "plugin_not_in_deps" | "parse_error" | "write_error" | null;
    message?: string;
}
export declare function syncCachePackageJsonToIntent(pluginInfo: PluginEntryInfo): SyncResult;
