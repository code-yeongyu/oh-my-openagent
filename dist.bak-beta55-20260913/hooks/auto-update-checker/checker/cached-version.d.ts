interface CachedVersionOptions {
    packageJsonCandidates?: readonly string[];
    findPackageJson?: (startPath: string) => string | null;
    currentDir?: string | null;
    execDir?: string | null;
}
export declare function getCachedVersion(options?: CachedVersionOptions): string | null;
export {};
