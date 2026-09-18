interface MessagePart {
    type?: string;
    name?: string;
    tool?: string;
    toolName?: string;
    state?: {
        status?: string;
    };
    text?: string;
    synthetic?: boolean;
}
interface Message {
    info?: {
        role?: string;
    };
    role?: string;
    parts?: MessagePart[];
}
export declare function hasUnansweredQuestion(messages: Message[]): boolean;
export {};
