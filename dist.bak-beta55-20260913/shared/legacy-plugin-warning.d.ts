import { type PluginEntry } from "./plugin-entry-shape";
export interface LegacyPluginCheckResult {
    hasLegacyEntry: boolean;
    hasCanonicalEntry: boolean;
    legacyEntries: PluginEntry[];
    configPath: string | null;
}
export declare function checkForLegacyPluginEntry(overrideConfigDir?: string): LegacyPluginCheckResult;
