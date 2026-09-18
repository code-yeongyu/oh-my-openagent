import type { PluginInput } from "@opencode-ai/plugin";
export declare function sendLinuxSessionNotification(ctx: PluginInput, title: string, message: string): Promise<void>;
export declare function playLinuxSessionNotificationSound(ctx: PluginInput, soundPath: string): Promise<void>;
