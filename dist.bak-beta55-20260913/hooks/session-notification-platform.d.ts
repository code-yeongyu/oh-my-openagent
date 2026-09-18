export type Platform = "darwin" | "linux" | "win32" | "unsupported";
export declare function detectPlatform(): Platform;
export declare function getDefaultSoundPath(platform: Platform): string;
