import type { BtwPromptRef, BtwSideControllerDependencies, BtwSideRecord, BtwSideState } from "./tui-controller-types";
export declare function createBtwSideController(dependencies: BtwSideControllerDependencies): {
    state: () => BtwSideState;
    sides: () => BtwSideRecord[];
    side: (sessionID: string) => BtwSideRecord | undefined;
    sideNumber: (sessionID: string) => number | undefined;
    rootParent: (sessionID: string) => string;
    startFromPrompt: (promptRef: BtwPromptRef, parentSessionID?: string | undefined) => Promise<boolean>;
    attachPromptRef: (sessionID: string, promptRef: BtwPromptRef | undefined) => void;
    toggle: () => void;
    close: () => Promise<void>;
    returnToParent: () => void;
    handleNavigation: (sessionID: string) => Promise<void>;
    handleSessionDeleted: (sessionID: string) => void;
    canCloseCurrentSide: () => boolean;
    adopt: (parentSessionID: string, sideSessionID: string, sideNumber?: number) => void;
    waitUntilClosed: () => Promise<void>;
    dispose: () => Promise<void>;
};
