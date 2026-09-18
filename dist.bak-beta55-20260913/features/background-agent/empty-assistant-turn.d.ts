type AssistantTurnInfo = {
    readonly role?: unknown;
    readonly finish?: unknown;
    readonly tokens?: unknown;
};
export declare function isEmptyNoProgressAssistantTurnInfo(info: unknown): info is AssistantTurnInfo;
export {};
