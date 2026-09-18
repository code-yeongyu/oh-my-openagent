import type { CompactionAgentConfigCheckpoint } from "../../shared/compaction-agent-config-checkpoint";
type PromptConfigInfo = {
    agent?: string;
    model?: {
        providerID?: string;
        modelID?: string;
        variant?: string;
    };
    providerID?: string;
    modelID?: string;
    variant?: string;
};
export declare function resolveValidatedModel(info: PromptConfigInfo | undefined): CompactionAgentConfigCheckpoint["model"] | undefined;
export declare function validateCheckpointModel(checkpointModel: CompactionAgentConfigCheckpoint["model"], currentModel: CompactionAgentConfigCheckpoint["model"]): CompactionAgentConfigCheckpoint["model"] | undefined;
export {};
