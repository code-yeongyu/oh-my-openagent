import type { InstallPlatform } from "./types";
export declare const SENPI_PLATFORM_ENV_FLAG = "OMO_ENABLE_SENPI_PLATFORM";
export declare function isSenpiPlatformEnabled(env?: NodeJS.ProcessEnv): boolean;
export declare function availableInstallPlatforms(env?: NodeJS.ProcessEnv): InstallPlatform[];
