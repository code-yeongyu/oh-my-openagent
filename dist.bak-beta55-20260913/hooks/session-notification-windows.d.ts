import type { PluginInput } from "@opencode-ai/plugin";
export declare function sendWindowsSessionNotification(ctx: PluginInput, title: string, message: string): Promise<void>;
export declare function playWindowsSessionNotificationSound(ctx: PluginInput, soundPath: string): Promise<void>;
