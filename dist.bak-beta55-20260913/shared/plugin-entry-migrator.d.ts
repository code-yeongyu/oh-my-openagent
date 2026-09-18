import { type PluginEntry } from "./plugin-entry-shape";
export declare function isLegacyEntry(entry: PluginEntry): boolean;
export declare function isCanonicalEntry(entry: PluginEntry): boolean;
export declare function toCanonicalEntry(entry: PluginEntry): PluginEntry;
