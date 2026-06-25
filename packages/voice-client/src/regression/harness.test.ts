/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import { CORPUS } from "./corpus";
import { runRegression } from "./harness";
import type { AnthropicCallStub, CorpusPrompt } from "./types";

const CLEAN_PROSE =
  "Certo. Questa è una risposta naturale, pensata per essere ascoltata direttamente, con ritmo conversazionale e senza formattazione speciale.";

function cleanCall(): AnthropicCallStub {
  return async () => ({ text: CLEAN_PROSE, model: "stub-model" });
}

describe("runRegression", () => {
  describe("#given clean prose for every prompt", () => {
    test("#when regression runs #then every corpus entry passes with zero violations", async () => {
      // given
      const call = cleanCall();

      // when
      const report = await runRegression({ call });

      // then
      expect(report.passed).toBe(CORPUS.length);
      expect(report.failed).toBe(0);
      expect(report.total_violations).toBe(0);
      expect(report.runs.every((run) => run.ok)).toBe(true);
    });
  });

  describe("#given a markdown table response", () => {
    test("#when regression runs #then the offending entry fails validation", async () => {
      // given
      const corpus = [prompt("table-case")];
      const call: AnthropicCallStub = async () => ({
        text: "| Name | Value |\n| --- | --- |\n| latency | low |",
        model: "stub-model",
      });

      // when
      const report = await runRegression({ call, corpus });

      // then
      expect(report.failed).toBe(1);
      expect(report.total_violations).toBeGreaterThanOrEqual(1);
      expect(report.runs[0]?.prompt_id).toBe("table-case");
      expect(report.runs[0]?.ok).toBe(false);
    });
  });

  describe("#given a backtick code-span response", () => {
    test("#when regression runs #then validation flags the response", async () => {
      // given
      const corpus = [prompt("code-span-case")];
      const call: AnthropicCallStub = async () => ({
        text: "Puoi pensare a `useState` come a una memoria locale del componente.",
        model: "stub-model",
      });

      // when
      const report = await runRegression({ call, corpus });

      // then
      expect(report.failed).toBe(1);
      expect(report.runs[0]?.violations.some((violation) => violation.ruleId === "code-span-single-backtick")).toBe(true);
    });
  });

  describe("#given a custom corpus with three prompts", () => {
    test("#when regression runs #then the report has three runs", async () => {
      // given
      const corpus = [prompt("one"), prompt("two"), prompt("three")];
      const call = cleanCall();

      // when
      const report = await runRegression({ call, corpus });

      // then
      expect(report.runs).toHaveLength(3);
      expect(report.passed).toBe(3);
    });
  });

  describe("#given a call that throws for one prompt", () => {
    test("#when regression runs #then that prompt is recorded as failed with explanatory violation", async () => {
      // given
      const corpus = [prompt("ok"), prompt("boom"), prompt("after")];
      const call: AnthropicCallStub = async (_system, messages) => {
        if (messages[0]?.content.includes("boom")) {
          throw new Error("network boom");
        }
        return { text: CLEAN_PROSE, model: "stub-model" };
      };

      // when
      const report = await runRegression({ call, corpus });

      // then
      const failed = report.runs.find((run) => run.prompt_id === "boom");
      expect(report.failed).toBe(1);
      expect(failed?.ok).toBe(false);
      expect(failed?.violations[0]?.description).toContain("network boom");
    });
  });

  describe("#given a custom system prompt", () => {
    test("#when regression runs #then the stub receives it verbatim", async () => {
      // given
      const seenSystems: string[] = [];
      const systemPrompt = "Voice mode custom preamble.";
      const corpus = [prompt("custom-system")];
      const call: AnthropicCallStub = async (system) => {
        seenSystems.push(system);
        return { text: CLEAN_PROSE, model: "stub-model" };
      };

      // when
      await runRegression({ call, corpus, systemPrompt });

      // then
      expect(seenSystems).toEqual([systemPrompt]);
    });
  });
});

function prompt(id: string): CorpusPrompt {
  return {
    id,
    lang: "en",
    scenario: "voice-mode-en",
    user_message: `Explain ${id} in conversational voice prose.`,
  };
}
