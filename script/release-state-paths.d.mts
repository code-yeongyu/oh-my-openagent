export declare function isReleaseStatePath(path: string): boolean
export declare function isGeneratedReleasePath(path: string): boolean
export declare function isVersionStampedPath(path: string): boolean
export declare function isReleaseNotesPath(path: string): boolean
export declare function versionRefusals(pin: string, stamp: string, version: string, nativeVersion: string): string[]
export declare function stampRefusals(base: string, head: string): string[]
export declare function wrapperPinRefusals(
  manifest: { readonly version?: string; readonly dependencies?: Readonly<Record<string, string>> },
  version: string,
): string[]
