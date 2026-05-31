/**
 * Sisyphus agent - multi-model orchestrator.
 *
 * This directory contains model-specific prompt variants:
 * - default.ts: Base implementation for Claude and general models
 * - claude-opus-4-7.ts: Native Claude Opus 4.7 prompt with literal-instruction tuning
 * - gemini.ts: Corrective overlays for Gemini's aggressive tendencies
 * - gpt-5-4.ts: Native GPT-5.4 prompt with block-structured guidance
 * - gpt-5-5.ts: Native GPT-5.5 prompt with Codex-style sections
 */

export { buildDefaultSisyphusPrompt, buildTaskManagementSection } from "./default";
export { buildClaudeOpus47SisyphusPrompt } from "./claude-opus-4-7";
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
