import { type MigrationBoundary, type MigrationClock, type MigrationEnvironment, type MigrationFileSystem, type MigrationRunResult } from "@oh-my-opencode/omo-config-core";
import { type ConfigMigrationDiscoveryFileSystem, type ConfigMigrationPathOperations } from "./config-migration";
export type OpenCodeStartupMigrationOptions = {
    readonly afterMigrations?: (results: readonly MigrationRunResult[]) => void;
    readonly backupTimestamp?: string;
    readonly clock?: MigrationClock;
    readonly cwd: string;
    readonly discoveryFileSystem?: ConfigMigrationDiscoveryFileSystem;
    readonly dryRun?: boolean;
    readonly environment?: Readonly<Record<string, string | undefined>>;
    readonly env?: MigrationEnvironment;
    readonly fileSystem?: MigrationFileSystem;
    readonly homeDir?: string;
    readonly isProcessAlive?: (pid: number) => boolean;
    readonly onBoundary?: (boundary: MigrationBoundary) => void;
    readonly pathOperations?: ConfigMigrationPathOperations;
    readonly pid?: number;
    readonly platform?: NodeJS.Platform;
};
export type OpenCodeStartupMigrationResult = {
    readonly error?: string;
    readonly journalResumed: boolean;
    readonly migratedFrom: readonly string[];
    readonly reloadRequired: boolean;
    readonly results: readonly MigrationRunResult[];
    readonly skippedConflictCount: number;
};
export declare function runOpenCodeStartupMigration(options: OpenCodeStartupMigrationOptions): OpenCodeStartupMigrationResult;
