import { fsyncSync } from "node:fs";
import type { FileHandle } from "node:fs/promises";
export declare function isToleratedFsyncError(error: unknown): boolean;
export declare function tolerantFsync(fileHandle: FileHandle, contextLabel: string): Promise<void>;
export declare function tolerantFsyncSync(fileDescriptor: number, contextLabel: string, fsyncImpl?: typeof fsyncSync): void;
