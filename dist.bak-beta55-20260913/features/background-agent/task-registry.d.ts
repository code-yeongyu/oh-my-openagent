import type { BackgroundTask } from "./types";
export declare function rememberBackgroundTask(task: BackgroundTask): void;
export declare function archiveBackgroundTask(task: BackgroundTask): void;
export declare function getRegisteredBackgroundTask(taskID: string): BackgroundTask | undefined;
export declare function forgetBackgroundTask(taskID: string): void;
export declare function clearBackgroundTaskRegistryForTesting(): void;
