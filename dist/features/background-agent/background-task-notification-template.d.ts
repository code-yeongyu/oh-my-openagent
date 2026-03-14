import type { BackgroundTask } from "./types";
export type BackgroundTaskNotificationStatus = "COMPLETED" | "CANCELLED" | "INTERRUPTED";
export declare function buildBackgroundTaskNotificationText(input: {
    task: BackgroundTask;
    duration: string;
    statusText: BackgroundTaskNotificationStatus;
    allComplete: boolean;
    remainingCount: number;
    completedTasks: BackgroundTask[];
}): string;
