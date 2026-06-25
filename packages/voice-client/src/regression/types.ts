import type { Violation } from "../validator";

export type CorpusPrompt = {
  id: string;
  lang: "it" | "en" | "it-en-mixed";
  user_message: string;
  scenario: "voice-mode-it" | "voice-mode-en" | "voice-mode-code-mix" | "caveman-collision" | "tool-use";
};

export type RegressionResult = {
  prompt_id: string;
  ok: boolean;
  violations: Violation[];
  response_text: string;
  model: string;
  latency_ms: number;
};

export type RegressionReport = {
  runs: RegressionResult[];
  passed: number;
  failed: number;
  total_violations: number;
  timestamp_iso: string;
};

export type AnthropicCallStub = (
  system: string,
  messages: { role: "user" | "assistant"; content: string }[],
) => Promise<{ text: string; model: string }>;
