/**
 * Minimum OpenCode version required for this plugin.
 * This plugin only supports OpenCode 1.4.0+.
 */
export declare const MINIMUM_OPENCODE_VERSION = "1.4.0";
/**
 * OpenCode version that introduced native AGENTS.md injection.
 * PR #10678 merged on Jan 26, 2026 - OpenCode now dynamically resolves
 * AGENTS.md files from subdirectories as the agent explores them.
 * When this version is detected, the directory-agents-injector hook
 * is auto-disabled to prevent duplicate AGENTS.md loading.
 */
export declare const OPENCODE_NATIVE_AGENTS_INJECTION_VERSION = "1.1.37";
/**
 * OpenCode version that introduced SQLite backend for storage.
 * When this version is detected AND opencode.db exists, SQLite backend is used.
 */
export declare const OPENCODE_SQLITE_VERSION = "1.1.53";
type ExecCommandOptions = {
    encoding: "utf-8";
    timeout: number;
    stdio: ["pipe", "pipe", "pipe"];
};
export type OpenCodeVersionDeps = {
    execCommand: (command: string, options: ExecCommandOptions) => string;
    getBinaryPath: () => string | null;
    exists: (filePath: string) => boolean;
    realpath: (filePath: string) => string;
    readText: (filePath: string) => string;
};
export declare function parseVersion(version: string): number[];
export declare function compareVersions(a: string, b: string): -1 | 0 | 1;
export declare function getOpenCodeVersion(deps?: Partial<OpenCodeVersionDeps>): string | null;
export declare function isOpenCodeVersionAtLeast(version: string): boolean;
export declare function resetVersionCache(): void;
export declare function setVersionCache(version: string | null): void;
export {};
