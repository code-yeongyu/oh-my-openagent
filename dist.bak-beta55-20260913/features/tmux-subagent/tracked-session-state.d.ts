import type { TrackedSession } from "./types";
export declare function createTrackedSession(params: {
    sessionId: string;
    paneId: string;
    description: string;
    now?: Date;
    attachActivated?: boolean;
}): TrackedSession;
export declare function markTrackedSessionClosePending(tracked: TrackedSession): TrackedSession;
