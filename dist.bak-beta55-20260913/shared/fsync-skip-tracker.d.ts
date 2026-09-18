import type { PathClassification } from "./classify-path-environment";
export type FsyncSkipEntry = {
    filePath: string;
    contextLabel: string;
    errorCode: string;
    message: string;
    pathClassification: PathClassification;
    timestamp: number;
};
export declare function recordFsyncSkip(entry: Omit<FsyncSkipEntry, "timestamp">): void;
export declare function drainSkipsAfter(timestampMs: number): FsyncSkipEntry[];
export declare function clearAllSkips(): void;
