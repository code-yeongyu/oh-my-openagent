export declare function resolveFilePath(filePath: string, cwd: string): string;
export declare function resolveFileReferencesInText(text: string, cwd?: string, depth?: number, maxDepth?: number): Promise<string>;
