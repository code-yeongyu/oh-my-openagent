export declare const BACKGROUND_COMPLETION_WAKE_PENDING_REASON = "background completion wake pending";
export type BackgroundTaskMarkerInput = {
    readonly directory: string;
    readonly parentSessionID: string;
    readonly activeTaskCount: number;
    readonly hasUndeliveredParentWake: boolean;
};
export declare function writeBackgroundTaskMarker(input: BackgroundTaskMarkerInput): void;
