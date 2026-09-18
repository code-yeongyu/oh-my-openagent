import type { ViewNode } from "./element-helpers";
import type { SidebarView } from "./state-types";
type ThemeLike = {
    readonly error?: unknown;
    readonly text?: unknown;
    readonly textMuted?: unknown;
    readonly warning?: unknown;
    readonly success?: unknown;
    readonly info?: unknown;
    readonly accent?: unknown;
    readonly borderSubtle?: unknown;
};
export declare function buildViewNodes(view: SidebarView, theme: ThemeLike): ViewNode[];
export declare function describeView(view: SidebarView): string;
export {};
