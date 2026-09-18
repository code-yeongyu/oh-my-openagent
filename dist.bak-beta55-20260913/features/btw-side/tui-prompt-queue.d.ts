import type { BtwPromptRef } from "./tui-controller-types";
export declare function createBtwPromptQueue(): {
    attach(sessionID: string, promptRef: BtwPromptRef | undefined): void;
    queue(sessionID: string, question: string): void;
    input(sessionID: string): string;
    hasAttachments(sessionID: string): boolean;
    clear(sessionID: string): void;
};
