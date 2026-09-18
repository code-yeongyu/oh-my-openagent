import type { BtwSessionMessage } from "./tui-controller-types";
export declare function isBtwCommandDraft(input: string): boolean;
export declare function parseBtwQuestion(input: string): {
    consumeDraft: boolean;
    question: string;
};
export declare function findBtwBoundaryMessageID(messages: BtwSessionMessage[]): string | undefined;
