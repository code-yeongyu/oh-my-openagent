import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
type SolidRuntime<Node> = {
    readonly createElement: (tag: string) => Node;
    readonly insert: (parent: Node, child: unknown, marker?: unknown, initial?: unknown) => unknown;
    readonly setProp: (node: Node, name: string, value: unknown, previous?: unknown) => unknown;
};
export declare function registerBtwSideTui<Node>(api: TuiPluginApi, solid: SolidRuntime<Node>): Promise<void>;
export {};
