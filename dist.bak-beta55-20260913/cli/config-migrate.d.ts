export type ConfigMigrateOptions = {
    readonly cwd?: string;
    readonly dryRun?: boolean;
    readonly environment?: Readonly<Record<string, string | undefined>>;
    readonly json?: boolean;
    readonly output?: (line: string) => void;
};
export declare function runConfigMigrate(options?: ConfigMigrateOptions): number;
