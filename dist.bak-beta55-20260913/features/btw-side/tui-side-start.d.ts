import type { BtwCreateSessionInput, BtwPromptRef, BtwSideControllerDependencies } from "./tui-controller-types";
export type PreparedBtwSideStart = {
    parentSessionID: string;
    originalDraft: string;
    consumeDraft: boolean;
    question: string;
    createInput: BtwCreateSessionInput;
};
export declare function prepareBtwSideStart(dependencies: BtwSideControllerDependencies, promptRef: BtwPromptRef, parentSessionID?: string | undefined): PreparedBtwSideStart | undefined;
