import type { PluginInput } from "@opencode-ai/plugin";
export declare function sendMacosSessionNotification(ctx: PluginInput, title: string, message: string): Promise<void>;
export declare function playMacosSessionNotificationSound(ctx: PluginInput, soundPath: string): Promise<void>;
