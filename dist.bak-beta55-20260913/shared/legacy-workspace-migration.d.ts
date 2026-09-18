export type LegacyWorkspaceMigrationResult = {
    migrated: boolean;
    skipped: string[];
};
export declare function migrateLegacyWorkspaceDirectory(directory: string): LegacyWorkspaceMigrationResult;
