export declare const SESSION_NEXT_EVENT_PREFIX = "session.next.";
export interface MessagePartInfo {
    readonly id: string | undefined;
    readonly sessionID: string | undefined;
    readonly role: string | undefined;
    readonly type: string | undefined;
    readonly delta: string | undefined;
    readonly tool: string | undefined;
    readonly text: string | undefined;
    readonly synthetic: boolean | undefined;
    readonly input: Record<string, unknown> | undefined;
    readonly state: {
        readonly status: string | undefined;
        readonly input: Record<string, unknown> | undefined;
    } | undefined;
    readonly field: string | undefined;
    readonly activityTime: Date | undefined;
}
export declare function resolveMessagePartInfo(properties: unknown): MessagePartInfo | undefined;
export declare function resolveSessionNextPartInfo(eventType: string, properties: unknown): MessagePartInfo | undefined;
export declare function isMessagePartForSession(partInfo: MessagePartInfo | undefined, sessionID: string): boolean;
export declare function hasOutputSignalFromPart(partInfo: MessagePartInfo | undefined, sessionID?: string): boolean;
export declare function isInternalInitiatorTextPart(partInfo: MessagePartInfo | undefined, sessionID?: string): boolean;
export declare function hasParentWakeOutputSignalFromPart(partInfo: MessagePartInfo | undefined, sessionID?: string): boolean;
