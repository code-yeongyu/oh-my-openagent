export declare const CODE_BLOCK_PATTERN: RegExp;
export declare const INLINE_CODE_PATTERN: RegExp;
import type { KeywordType } from "../../config/schema/keyword-detector";
import { getUltraworkMessage, isPlannerAgent, isNonOmoAgent } from "./ultrawork";
import { TEAM_PATTERN, TEAM_MESSAGE } from "./team";
import { HYPERPLAN_PATTERN, HYPERPLAN_MESSAGE } from "./hyperplan";
export { isPlannerAgent, isNonOmoAgent, getUltraworkMessage };
export { TEAM_PATTERN, TEAM_MESSAGE };
export { HYPERPLAN_PATTERN, HYPERPLAN_MESSAGE };
export declare const HYPERPLAN_ULTRAWORK_PATTERN: RegExp;
export declare function getHyperplanUltraworkMessage(agentName?: string, modelID?: string): string;
export type KeywordDetector = {
    type: KeywordType;
    pattern: RegExp;
    message: string | ((agentName?: string, modelID?: string) => string);
};
export declare const KEYWORD_DETECTORS: KeywordDetector[];
