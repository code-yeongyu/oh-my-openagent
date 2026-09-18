import type { TuiPluginModule } from "@opencode-ai/plugin/tui";
type SidebarSlotRegistration<Node> = {
    readonly order: number;
    readonly slots: {
        readonly sidebar_content: () => Node | (() => Node);
    };
};
type RegisterSidebarContentSlotInput<Node> = {
    readonly registerSlot: (registration: SidebarSlotRegistration<Node>) => void;
    readonly requestRender: () => void;
    readonly renderSidebar: () => Node;
};
export declare function registerSidebarContentSlot<Node>({ registerSlot, requestRender, renderSidebar, }: RegisterSidebarContentSlotInput<Node>): void;
export declare function handleTuiPollError(error: unknown, reportPollError?: (error: Error) => void): void;
declare const module: TuiPluginModule;
export default module;
