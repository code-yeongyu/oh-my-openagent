import type { DiscoveredLegacyConfigSource } from "./types";
import type { LoadedLegacyConfigSource } from "./transform-types";
export declare function legacyMigrationHistory(discovered: readonly DiscoveredLegacyConfigSource[], loaded: readonly LoadedLegacyConfigSource[]): Record<string, readonly string[]>;
