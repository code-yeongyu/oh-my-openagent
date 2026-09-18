import { existsSync } from "node:fs";
import type { CheckResult, SystemInfo } from "../framework/types";
import { findOpenCodeBinary, getOpenCodeVersion, compareVersions } from "./system-binary";
import { getPluginInfo } from "./system-plugin";
import { getLatestPluginVersion, getLoadedPluginVersion, getSuggestedInstallTag } from "./system-loaded-version";
interface SystemCheckDeps {
    findOpenCodeBinary: typeof findOpenCodeBinary;
    getOpenCodeVersion: typeof getOpenCodeVersion;
    compareVersions: typeof compareVersions;
    getPluginInfo: typeof getPluginInfo;
    getLoadedPluginVersion: typeof getLoadedPluginVersion;
    getLatestPluginVersion: typeof getLatestPluginVersion;
    getSuggestedInstallTag: typeof getSuggestedInstallTag;
    configExists: typeof existsSync;
    readConfigFile: (path: string) => string;
    parseConfigContent: (content: string) => unknown;
}
export declare function gatherSystemInfo(deps?: SystemCheckDeps): Promise<SystemInfo>;
export declare function checkSystem(deps?: SystemCheckDeps): Promise<CheckResult>;
export {};
