import type { PluginInput } from "@opencode-ai/plugin";
import type { Platform } from "./session-notification-platform";
export declare function sendSessionNotification(ctx: PluginInput, platform: Platform, title: string, message: string): Promise<void>;
