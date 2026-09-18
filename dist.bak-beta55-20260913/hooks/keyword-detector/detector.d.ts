import type { KeywordType } from "../../config/schema/keyword-detector";
export interface DetectedKeyword {
    type: KeywordType;
    message: string;
}
export declare function removeCodeBlocks(text: string): string;
export declare function looksLikeSlashCommand(text: string): boolean;
export declare function detectKeywords(text: string, agentName?: string, modelID?: string, disabledKeywords?: ReadonlyArray<KeywordType>, enabledExpansions?: ReadonlyArray<KeywordType>): string[];
export declare function detectKeywordsWithType(text: string, agentName?: string, modelID?: string, disabledKeywords?: ReadonlyArray<KeywordType>, enabledExpansions?: ReadonlyArray<KeywordType>): DetectedKeyword[];
export declare function extractPromptText(parts: Array<{
    type: string;
    text?: string;
    synthetic?: boolean;
}>): string;
