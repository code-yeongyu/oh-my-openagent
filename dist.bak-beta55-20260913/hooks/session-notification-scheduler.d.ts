import type { PluginInput } from "@opencode-ai/plugin";
type SessionNotificationConfig = {
    playSound: boolean;
    soundPath: string;
    idleConfirmationDelay: number;
    skipIfIncompleteTodos: boolean;
    maxTrackedSessions: number;
    /** Grace period in ms to ignore late-arriving activity events after scheduling (default: 100) */
    activityGracePeriodMs?: number;
};
export declare function createIdleNotificationScheduler(options: {
    ctx: PluginInput;
    config: SessionNotificationConfig;
    hasIncompleteTodos: (ctx: PluginInput, sessionID: string) => Promise<boolean>;
    send: (ctx: PluginInput, sessionID: string) => Promise<void>;
    playSound: (ctx: PluginInput, soundPath: string) => Promise<void>;
}): {
    markSessionActivity: (sessionID: string) => void;
    scheduleIdleNotification: (sessionID: string) => void;
    deleteSession: (sessionID: string) => void;
};
export {};
