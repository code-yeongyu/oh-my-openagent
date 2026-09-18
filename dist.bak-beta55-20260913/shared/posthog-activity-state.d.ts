type PostHogActivityCaptureState = {
    dayUTC: string;
    captureDaily: boolean;
};
export declare function getPostHogActivityCaptureState(now?: Date): PostHogActivityCaptureState;
export {};
