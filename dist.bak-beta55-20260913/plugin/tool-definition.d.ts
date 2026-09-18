import type { CreatedHooks } from "../create-hooks";
export declare function createToolDefinitionHandler(args: {
    hooks: CreatedHooks;
}): (input: {
    toolID: string;
}, output: {
    description: string;
    parameters: unknown;
}) => Promise<void>;
