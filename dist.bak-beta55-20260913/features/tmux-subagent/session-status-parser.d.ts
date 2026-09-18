type SessionStatus = {
    type: string;
};
export declare function parseSessionStatusResponse(response: unknown): Record<string, SessionStatus>;
export declare function parseSessionStatusMap(data: unknown): Record<string, SessionStatus>;
export {};
