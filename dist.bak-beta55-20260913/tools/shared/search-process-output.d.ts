import type { SpawnedProcess } from "../../shared/bun-spawn-shim";
export interface SearchProcessOutput {
    readonly stdout: string;
    readonly stderr: string;
    readonly exitCode: number;
}
export declare function collectSearchProcessOutput(proc: SpawnedProcess, timeoutMs: number, timeoutMessage: string): Promise<SearchProcessOutput>;
