export interface ParsedUserRequest {
    planName: string | null;
    explicitWorktreePath: string | null;
    makePr: boolean;
    ship: boolean;
}
export declare function parseUserRequest(promptText: string): ParsedUserRequest;
