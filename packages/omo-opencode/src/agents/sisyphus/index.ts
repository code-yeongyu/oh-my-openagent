/**
 * Sisyphus agent - multi-model orchestrator.
 *
 * This directory contains model-specific prompt variants:
 * - default.ts: Base implementation for Claude and general models
 * - claude-opus-4-7.ts: Native Claude Opus 4.7 prompt with literal-instruction tuning
 * - claude-opus-4-8.ts: Native Claude Opus 4.8 prompt with silence-default + autonomy tuning
 * - claude-fable-5.ts: Native Claude Fable 5 prompt (Opus 4.8 direction, top-tier model)
 * - gemini.ts: Corrective overlays for Gemini's aggressive tendencies
 * - gpt-5-4.ts: Native GPT-5.4 prompt with block-structured guidance
 * - gpt-5-5.ts: Native GPT-5.5 prompt with Codex-style sections
 */

export { buildDefaultSisyphusPrompt, buildTaskManagementSection } from "./default";
export { buildClaudeOpus47SisyphusPrompt } from "./claude-opus-4-7";
export { buildClaudeOpus48SisyphusPrompt } from "./claude-opus-4-8";
export { buildClaudeFable5SisyphusPrompt } from "./claude-fable-5";
export {
  buildGeminiToolMandate,
  buildGeminiDelegationOverride,
  buildGeminiVerificationOverride,
  buildGeminiIntentGateEnforcement,
  buildGeminiToolGuide,
  buildGeminiToolCallExamples,
} from "./gemini";
export { buildGpt54SisyphusPrompt } from "./gpt-5-4";
export { buildGpt55SisyphusPrompt } from "./gpt-5-5";
export { buildKimiK26SisyphusPrompt } from "./kimi-k2-6";
