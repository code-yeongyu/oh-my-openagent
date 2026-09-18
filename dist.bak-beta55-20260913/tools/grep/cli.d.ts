import { type SpawnOptions, type SpawnedProcess } from "../../shared/bun-spawn-shim";
import { type ResolvedCli } from "../../shared/ripgrep-cli";
import type { GrepOptions, GrepResult, CountResult } from "./types";
export type SearchProcessSpawner = (command: string[], options?: SpawnOptions) => SpawnedProcess;
export declare function runRg(options: GrepOptions, resolvedCli?: ResolvedCli, processSpawner?: SearchProcessSpawner): Promise<GrepResult>;
export declare function runRgCount(options: Omit<GrepOptions, "context">, resolvedCli?: ResolvedCli, processSpawner?: SearchProcessSpawner): Promise<CountResult[]>;
