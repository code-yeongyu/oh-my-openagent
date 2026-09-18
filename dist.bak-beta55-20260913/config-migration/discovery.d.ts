import { type ConfigMigrationDiscoveryOptions, type LegacyConfigMigrationGroup } from "./types";
export declare const OPENCODE_CONFIG_MIGRATION_ID = "2026-07-opencode-config-unification";
export declare const CONFIG_JSONC_MIGRATION_ID = "2026-07-codex-config-jsonc";
export declare function discoverLegacyConfigGroups(options: ConfigMigrationDiscoveryOptions): readonly LegacyConfigMigrationGroup[];
