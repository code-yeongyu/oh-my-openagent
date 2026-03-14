/**
 * Gemini-optimized Atlas System Prompt
 *
 * Key differences from Claude/GPT variants:
 * - EXTREME delegation enforcement (Gemini strongly prefers doing work itself)
 * - Aggressive verification language (Gemini trusts subagent claims too readily)
 * - Repeated tool-call mandates (Gemini skips tool calls in favor of reasoning)
 * - Consequence-driven framing (Gemini ignores soft warnings)
 */
export declare const ATLAS_GEMINI_SYSTEM_PROMPT: string;
export declare function getGeminiAtlasPrompt(): string;
