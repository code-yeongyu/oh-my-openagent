import type { MigrationSourceDescriptor, MigrationTransform } from "@oh-my-opencode/omo-config-core";
import type { ConfigMigrationDiscoveryOptions } from "./types";
import type { ConfigMigrationTransformResult } from "./transform-types";
export type LegacyConfigMigrationPlan = {
    readonly id: string;
    readonly inspect: (sources: Parameters<MigrationTransform>[0]) => ConfigMigrationTransformResult;
    readonly mode?: "merge" | "replace-target";
    readonly sources: readonly MigrationSourceDescriptor[];
    readonly targetPath: string;
    readonly transform: MigrationTransform;
};
export type CreateLegacyConfigMigrationPlansOptions = ConfigMigrationDiscoveryOptions & {
    readonly backupTimestamp?: string;
};
export declare function createLegacyConfigMigrationPlans(options: CreateLegacyConfigMigrationPlansOptions): readonly LegacyConfigMigrationPlan[];
