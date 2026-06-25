import { validate } from "../validator/validator";
import { CORPUS } from "./corpus";
import type { AnthropicCallStub, CorpusPrompt, RegressionReport, RegressionResult } from "./types";
import type { Violation } from "../validator";

const DEFAULT_SYSTEM_PROMPT =
  "Voice mode is active. Reply in conversational prose suitable for direct TTS reading. No bullet lists, no tables, no markdown headers, no code blocks for ordinary words, no caveman compression. Italian and English both acceptable.";

export async function runRegression(opts: {
  call: AnthropicCallStub;
  corpus?: CorpusPrompt[];
  systemPrompt?: string;
}): Promise<RegressionReport> {
  const corpus = opts.corpus ?? CORPUS;
  const system = opts.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const runs: RegressionResult[] = [];

  for (const prompt of corpus) {
    runs.push(await runPrompt(prompt, system, opts.call));
  }

  const passed = runs.filter((run) => run.ok).length;
  const failed = runs.length - passed;
  const totalViolations = runs.reduce((total, run) => total + run.violations.length, 0);

  return {
    runs,
    passed,
    failed,
    total_violations: totalViolations,
    timestamp_iso: new Date().toISOString(),
  };
}

async function runPrompt(prompt: CorpusPrompt, system: string, call: AnthropicCallStub): Promise<RegressionResult> {
  const startedAt = performance.now();

  try {
    const response = await call(system, [{ role: "user", content: prompt.user_message }]);
    const validation = validate(response.text);
    const violations = validation.ok ? [] : validation.violations;

    return {
      prompt_id: prompt.id,
      ok: validation.ok,
      violations,
      response_text: response.text,
      model: response.model,
      latency_ms: elapsedSince(startedAt),
    };
  } catch (error) {
    return {
      prompt_id: prompt.id,
      ok: false,
      violations: [callErrorViolation(error)],
      response_text: "",
      model: "call-error",
      latency_ms: elapsedSince(startedAt),
    };
  }
}

function elapsedSince(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

function callErrorViolation(error: unknown): Violation {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ruleId: "anthropic-call-error",
    offset: 0,
    length: 0,
    snippet: "",
    description: `Anthropic call failed: ${message}`,
  };
}
