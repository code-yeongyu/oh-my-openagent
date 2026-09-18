import type { Platform } from "./session-notification-sender";
export declare function createSessionNotificationInit(): {
    initialize: () => {
        platform: Platform;
        defaultSoundPath: string;
    };
};
