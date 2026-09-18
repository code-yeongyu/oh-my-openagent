import type { ToolResultInfo } from "./tool-part-types";
export declare function findToolResultsBySize(sessionID: string): ToolResultInfo[];
export declare function findLargestToolResult(sessionID: string): ToolResultInfo | null;
export declare function truncateToolResult(partPath: string): {
    success: boolean;
    toolName?: string;
    originalSize?: number;
};
/**
 * Infrastructure for the future distillation feature (issue #1734).
 *
 * The non-destructive truncation in `truncateToolResult()` writes the original
 * tool output to `{partPath}.original`. This function reads that backup so the
 * distiller can access the full output even after the live part file has been
 * truncated. It is not called anywhere today because the distillation consumer
 * has not been implemented yet.
 */
export declare function recoverTruncatedOutput(partPath: string): string | null;
export declare function cleanupTruncationBackups(sessionID: string): number;
export declare function getTotalToolOutputSize(sessionID: string): number;
export declare function countTruncatedResults(sessionID: string): number;
