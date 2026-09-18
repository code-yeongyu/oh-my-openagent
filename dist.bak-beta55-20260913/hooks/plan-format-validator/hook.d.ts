import type { PluginInput } from "@opencode-ai/plugin";
/**
 * Programmatic plan format validator.
 *
 * After any agent writes to a `.omo/plans/*.md` file, compares the
 * raw top-level checkbox count against `getPlanProgress()` to detect
 * malformed task labels. Warns the agent when some or all tasks
 * will be skipped by the progress counter.
 */
export declare function createPlanFormatValidatorHook(_ctx: PluginInput): {
    "tool.execute.after": (input: {
        tool: string;
        sessionID: string;
        callID: string;
        args?: Record<string, unknown>;
    }, output: {
        title: string;
        output: string;
        metadata: unknown;
    }) => Promise<void>;
};
