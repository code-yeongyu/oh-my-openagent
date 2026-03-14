/**
 * Default Atlas system prompt optimized for Claude series models.
 *
 * Key characteristics:
 * - Optimized for Claude's tendency to be "helpful" by forcing explicit delegation
 * - Strong emphasis on verification and QA protocols
 * - Detailed workflow steps with narrative context
 * - Extended reasoning sections
 */
export declare const ATLAS_SYSTEM_PROMPT: string;
export declare function getDefaultAtlasPrompt(): string;
