type ParentWakeMessageTime = {
    readonly created?: unknown;
    readonly updated?: unknown;
    readonly completed?: unknown;
    readonly start?: unknown;
    readonly end?: unknown;
};
type ParentWakeMessageActivityPart = {
    readonly time?: ParentWakeMessageTime;
    readonly state?: {
        readonly time?: ParentWakeMessageTime;
    };
};
type ParentWakeMessageActivity = {
    readonly info?: {
        readonly time?: ParentWakeMessageTime;
    };
    readonly time?: ParentWakeMessageTime;
    readonly parts?: readonly ParentWakeMessageActivityPart[];
};
export declare function getParentWakeMessageCreatedAt(message: ParentWakeMessageActivity): number | undefined;
export declare function getParentWakeMessageActivityAt(message: ParentWakeMessageActivity): number | undefined;
export {};
