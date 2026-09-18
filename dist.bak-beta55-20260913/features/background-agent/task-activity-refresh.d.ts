import type { SessionActivityResolver } from "./session-activity";
import type { BackgroundTask } from "./types";
export type TaskActivityRefreshResult = {
    readonly type: "activity";
    readonly activityTime: number;
} | {
    readonly type: "missing";
} | {
    readonly type: "unavailable";
};
export declare function refreshTaskActivityFromSession(task: BackgroundTask, getSessionActivity: SessionActivityResolver): Promise<TaskActivityRefreshResult>;
