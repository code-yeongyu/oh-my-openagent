import { applyLayout } from "@oh-my-opencode/tmux-core";
import type { MainPaneWidthOptions } from "@oh-my-opencode/tmux-core";
export declare function enforceMainPaneWidth(mainPaneId: string, windowWidth: number, mainPaneSizeOrOptions?: number | MainPaneWidthOptions): Promise<void>;
export { applyLayout };
export type { MainPaneWidthOptions };
