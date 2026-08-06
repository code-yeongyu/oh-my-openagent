export type GitBashResolution =
	| { found: true; path: string | null; source: string; checkedPaths: string[] }
	| { found: false; checkedPaths: string[]; installHint: string };

export declare function resolveGitBash(options: {
	platform: string;
	env: Record<string, string | undefined>;
	exists: (path: string) => boolean;
	where: (command: string) => string[];
}): GitBashResolution;

export declare function resolveGitBashForCurrentProcess(options?: {
	platform?: string;
	env?: Record<string, string | undefined>;
}): GitBashResolution;

export declare function prepareGitBashForInstall(options: {
	platform: string;
	env: Record<string, string | undefined>;
	cwd: string;
	runCommand: (command: string, args: readonly string[], options: { cwd: string }) => Promise<unknown>;
	resolveGitBash?: () => GitBashResolution;
}): Promise<GitBashResolution>;
