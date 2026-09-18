import type { DetectedConfig, InstallConfig, InstallPlatform } from "./types";
export declare function promptInstallPlatform(initialValue?: InstallPlatform): Promise<InstallPlatform | null>;
export declare function promptInstallConfig(detected: DetectedConfig, platform: InstallPlatform, codexAutonomousOverride?: boolean): Promise<InstallConfig | null>;
