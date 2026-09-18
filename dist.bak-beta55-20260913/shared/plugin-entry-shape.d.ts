export type PluginEntryOptions = Record<string, unknown>;
export type PluginTupleEntry = readonly [string, PluginEntryOptions];
export type PluginEntry = string | PluginTupleEntry;
export declare function isPluginTupleEntry(entry: unknown): entry is PluginTupleEntry;
export declare function getPluginEntryName(entry: PluginEntry): string;
export declare function withPluginEntryName(entry: PluginEntry, name: string): PluginEntry;
