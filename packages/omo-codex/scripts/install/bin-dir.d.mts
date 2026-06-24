export declare function resolveCodexInstallerBinDir(options?: {
	codexHome?: string;
	env?: Record<string, string | undefined>;
	homeDir?: string;
}): string;

export declare function nonEmptyEnvValue(env: Record<string, string | undefined>, key: string): string | undefined;
