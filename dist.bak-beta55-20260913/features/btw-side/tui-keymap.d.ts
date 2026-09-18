import type { TuiPluginApi, TuiPromptRef } from "@opencode-ai/plugin/tui";
import type { createBtwSideController } from "./tui-controller";
type BtwSideController = ReturnType<typeof createBtwSideController>;
export type BtwSideKeymapRegistration = {
    unregister: Array<() => void>;
    resetEscapeSequence: () => void;
};
export declare function registerBtwSideKeymap(args: {
    api: TuiPluginApi;
    controller: BtwSideController;
    activePromptRef: () => TuiPromptRef | undefined;
    openBtw: () => Promise<void>;
    openPicker: () => Promise<void>;
    isCurrentSideIdle: () => boolean;
    returnToParent: () => void;
}): BtwSideKeymapRegistration;
export {};
