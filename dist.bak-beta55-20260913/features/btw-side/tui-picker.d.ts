import type { TuiPluginApi, TuiPromptRef } from "@opencode-ai/plugin/tui";
import type { createBtwSideController } from "./tui-controller";
type BtwSideController = ReturnType<typeof createBtwSideController>;
export declare function openBtwPicker(args: {
    api: TuiPluginApi;
    controller: BtwSideController;
    activePromptRef: () => TuiPromptRef | undefined;
}): Promise<boolean>;
export {};
