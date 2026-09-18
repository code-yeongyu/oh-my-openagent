import type { PluginInput } from "@opencode-ai/plugin";
import type { Platform } from "./session-notification-platform";
export declare function playSessionNotificationSound(ctx: PluginInput, platform: Platform, soundPath: string): Promise<void>;
