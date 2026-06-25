import Anthropic from "@anthropic-ai/sdk";
import { CORPUS } from "./corpus";
import { runRegression } from "./harness";
import type { AnthropicCallStub } from "./types";

export async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error("ANTHROPIC_API_KEY is required to run voice regression.");
  }

  const client = new Anthropic({ apiKey });
  const call: AnthropicCallStub = async (system, messages) => {
    const message = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system,
      messages,
    });

    return {
      text: message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n"),
      model: message.model,
    };
  };

  const report = await runRegression({ call, corpus: CORPUS });
  const summary = [
    `voice regression ${report.passed}/${report.runs.length} passed`,
    `failed: ${report.failed}`,
    `violations: ${report.total_violations}`,
    `timestamp: ${report.timestamp_iso}`,
  ].join("\n");

  console.log(summary);
}

if (import.meta.main) {
  await main();
}
