import type { SessionState } from "./types";
export declare function classifyFinalWaveVerdict(output: string): "approve" | "reject" | "missing";
export declare function shouldPauseForFinalWaveApproval(input: {
    planPath: string;
    taskOutput: string;
    sessionState: SessionState;
}): boolean;
