import type { TuiRuntimeSnapshot } from "./snapshot-schema";
export declare function writeMirror(projectDir: string, snapshot: TuiRuntimeSnapshot): void;
export declare function readMirror(projectDir: string): TuiRuntimeSnapshot | null;
