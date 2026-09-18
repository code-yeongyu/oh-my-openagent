import type { ConfigMigrationPathOperations } from "../../../config-migration";
import type { DoctorIssue } from "../framework/types";
export type LegacyConfigLeftoverOptions = {
    readonly cwd: string;
    readonly environment?: Readonly<Record<string, string | undefined>>;
    readonly homeDir: string;
    readonly pathOperations?: ConfigMigrationPathOperations;
};
export declare function findLegacyConfigLeftovers(options: LegacyConfigLeftoverOptions): readonly string[];
export declare function legacyConfigLeftoverWarning(paths: readonly string[]): DoctorIssue | undefined;
