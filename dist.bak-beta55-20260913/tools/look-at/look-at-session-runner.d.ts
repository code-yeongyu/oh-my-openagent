import type { PluginInput } from "@opencode-ai/plugin";
import type { ToolContext } from "@opencode-ai/plugin/tool";
import type { LookAtInputPart } from "./look-at-input-preparer";
interface RunLookAtSessionInput {
    ctx: PluginInput;
    toolContext: ToolContext;
    goal: string;
    inputParts: LookAtInputPart[];
}
export declare function runLookAtSession({ ctx, toolContext, goal, inputParts, }: RunLookAtSessionInput): Promise<string>;
export {};
