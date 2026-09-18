interface InvalidatePackageOptions {
    acceptedPackageNames?: readonly string[];
    cacheDir?: string;
    defaultPackageName?: string;
    userConfigDir?: string;
}
export declare function invalidatePackage(packageName?: string, options?: InvalidatePackageOptions): boolean;
/** @deprecated Use invalidatePackage instead - this nukes ALL plugins */
export declare function invalidateCache(): boolean;
export {};
