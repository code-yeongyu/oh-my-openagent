export const DEFAULT_FILE_NAMES = ["AGENTS.md"] as const;
export const DEFAULT_MAX_BYTES_PER_FILE = 32 * 1024;
export const DEFAULT_MAX_BYTES_PER_READ = 128 * 1024;

export interface InjectedFileInfo {
	absolutePath: string;
	directory: string;
	truncated: boolean;
	originalBytes: number;
	injectedBytes: number;
}

export interface InjectionFileError {
	path: string;
	error: Error;
}

export interface InjectionResult {
	injectedText: string;
	injectedFiles: InjectedFileInfo[];
	errors: InjectionFileError[];
}

export interface InjectionConfig {
	fileNames: readonly string[];
	maxBytesPerFile: number;
	maxBytesPerRead: number;
}
