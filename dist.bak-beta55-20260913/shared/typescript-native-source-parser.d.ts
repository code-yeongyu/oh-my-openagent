import type { SourceFile } from "typescript/unstable/ast";
export declare class TypeScriptSourceParser {
    #private;
    constructor(cwd: string);
    parse(filePaths: readonly string[]): Promise<ReadonlyMap<string, SourceFile>>;
    close(): Promise<void>;
}
