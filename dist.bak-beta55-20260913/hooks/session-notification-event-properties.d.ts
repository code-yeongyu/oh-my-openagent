type EventProperties = Record<string, unknown> | undefined;
export declare function getSessionID(properties: EventProperties): string | undefined;
export declare function getEventToolName(properties: EventProperties): string | undefined;
export declare function getQuestionText(properties: EventProperties): string;
export {};
