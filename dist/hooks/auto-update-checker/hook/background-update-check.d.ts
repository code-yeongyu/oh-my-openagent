import type { PluginInput } from "@opencode-ai/plugin";
export declare function runBackgroundUpdateCheck(ctx: PluginInput, autoUpdate: boolean, getToastMessage: (isUpdate: boolean, latestVersion?: string) => string): Promise<void>;
