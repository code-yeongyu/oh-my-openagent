type MessageTime = {
    created?: number | string;
} | number | string | undefined;
type MessageInfo = {
    id?: string;
    time?: MessageTime;
};
export type CursorMessage = {
    info?: MessageInfo;
};
export declare function consumeNewMessages<T extends CursorMessage>(sessionID: string | undefined, messages: T[]): T[];
export declare function resetMessageCursor(sessionID?: string): void;
export {};
