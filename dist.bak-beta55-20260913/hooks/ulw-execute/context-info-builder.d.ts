import { readBoulderState } from "../../features/boulder-state";
import type { PluginInput } from "@opencode-ai/plugin";
export declare function buildUlwExecuteContextInfo(params: {
    readonly ctx: PluginInput;
    readonly explicitPlanName: string | null;
    readonly existingState: ReturnType<typeof readBoulderState>;
    readonly sessionId: string;
    readonly timestamp: string;
    readonly activeAgent: string;
    readonly worktreePath: string | undefined;
    readonly worktreeBlock: string;
    readonly preferredPlanPath?: string | null;
}): string;
