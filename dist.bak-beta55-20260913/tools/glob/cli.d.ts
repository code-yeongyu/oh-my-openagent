import { type SpawnOptions, type SpawnedProcess } from "../../shared/bun-spawn-shim";
import { type GrepBackend } from "./constants";
import type { GlobOptions, GlobResult } from "./types";
export interface ResolvedCli {
    path: string;
    backend: GrepBackend;
}
export type SearchProcessSpawner = (command: string[], options?: SpawnOptions) => SpawnedProcess;
declare function buildRgArgs(options: GlobOptions): string[];
declare function buildFindArgs(options: GlobOptions): string[];
declare function buildPowerShellCommand(options: GlobOptions): string[];
export { buildRgArgs, buildFindArgs, buildPowerShellCommand };
export declare function runRgFiles(options: GlobOptions, resolvedCli?: ResolvedCli, processSpawner?: SearchProcessSpawner): Promise<GlobResult>;
