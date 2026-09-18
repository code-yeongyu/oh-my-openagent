import { type PluginEntry } from "../../../shared";
export interface PluginInfo {
    registered: boolean;
    configPath: string | null;
    entry: PluginEntry | null;
    isPinned: boolean;
    pinnedVersion: string | null;
    isLocalDev: boolean;
}
declare function detectConfigPath(): string | null;
declare function findPluginEntry(entries: PluginEntry[]): {
    entry: PluginEntry;
    isLocalDev: boolean;
} | null;
export declare function getPluginInfo(): PluginInfo;
export { detectConfigPath, findPluginEntry };
