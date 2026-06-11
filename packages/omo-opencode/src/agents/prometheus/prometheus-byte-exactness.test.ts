/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { getPrometheusPrompt } from "./system-prompt"

type PrometheusPromptBaseline = {
  readonly name: string
  readonly model: string | undefined
  readonly disabledTools: readonly string[]
  readonly sha256: string
  readonly shouldContainQuestionTool: boolean
}

const PROMETHEUS_PROMPT_BASELINES: readonly PrometheusPromptBaseline[] = [
  {
    name: "default-enabled",
    model: undefined,
    disabledTools: [],
    sha256: "c1c68ab2121e1e77aca291657aafca0bc88cad006abe64c3c5ef0a8c3595ee07",
    shouldContainQuestionTool: true,
  },
  {
    name: "default-question-disabled",
    model: undefined,
    disabledTools: ["question"],
    sha256: "72e95540669b48007e39973b99843fb8630ae701b68ac98b6d56ab0b14e3884a",
    shouldContainQuestionTool: false,
  },
  {
    name: "gpt-enabled",
    model: "gpt-5.5",
    disabledTools: [],
    sha256: "45254b266dfa17294547b55fc55f7549c0dff6ef6c0e688aee7ab64322ffd67f",
    shouldContainQuestionTool: true,
  },
  {
    name: "gpt-question-disabled",
    model: "gpt-5.5",
    disabledTools: ["question"],
    sha256: "19ceb0b28b294f95fb9c024a7d570fedc77df8b1cf94ae9d5e070076a64d0dd4",
    shouldContainQuestionTool: false,
  },
  {
    name: "gemini-enabled",
    model: "gemini-3.1-pro",
    disabledTools: [],
    sha256: "b08732c1047f88ddcc2ab351fe744d5e38dde1d134ea86bb064f462d7dddefcc",
    shouldContainQuestionTool: true,
  },
  {
    name: "gemini-question-disabled",
    model: "gemini-3.1-pro",
    disabledTools: ["question"],
    sha256: "192bc37467b0dcce4a636d61696bab8ea011ca517f657b66bd17896dace5b313",
    shouldContainQuestionTool: false,
  },
  {
    name: "claude-fable-5-enabled",
    model: "anthropic/claude-fable-5",
    disabledTools: [],
    sha256: "e2eddb507144bfc58077f7b639e637ea10b0233fe4c527550e3cccb3a3e84a8d",
    shouldContainQuestionTool: true,
  },
  {
    name: "claude-fable-5-question-disabled",
    model: "anthropic/claude-fable-5",
    disabledTools: ["question"],
    sha256: "cedb503c5e12d36ece93182125eceacc570431581b2bab6c3d391e1a9a0eeafe",
    shouldContainQuestionTool: false,
  },
  {
    name: "claude-opus-4-8-enabled",
    model: "anthropic/claude-opus-4-8",
    disabledTools: [],
    sha256: "b7dd5acd7c273972854455bec0f4d890125072b2d43a322dd5ac7d6b455c01a9",
    shouldContainQuestionTool: true,
  },
  {
    name: "claude-opus-4-8-question-disabled",
    model: "anthropic/claude-opus-4-8",
    disabledTools: ["question"],
    sha256: "0d6030028f7ffd39f051bec8e83d8785256bada55d9d837dcd4b62288a7fed5c",
    shouldContainQuestionTool: false,
  },
  {
    name: "claude-opus-4-7-enabled",
    model: "anthropic/claude-opus-4-7",
    disabledTools: [],
    sha256: "590e2a119b1e9a2db05cc3856b4bbc2f18109281dfbfa16e6a19fa1b2868266e",
    shouldContainQuestionTool: true,
  },
  {
    name: "claude-opus-4-7-question-disabled",
    model: "anthropic/claude-opus-4-7",
    disabledTools: ["question"],
    sha256: "bd6498f7f80ab629aa9f4d2786aade82c6c403f626f326786cb6db1c63290c82",
    shouldContainQuestionTool: false,
  },
  {
    name: "claude-opus-4-6-enabled",
    model: "anthropic/claude-opus-4-6",
    disabledTools: [],
    sha256: "5ae419c9f3d2de4ee3ba7cb1105451d36d8602ab109ddc2cba58c4265da7c86b",
    shouldContainQuestionTool: true,
  },
  {
    name: "claude-opus-4-6-question-disabled",
    model: "anthropic/claude-opus-4-6",
    disabledTools: ["question"],
    sha256: "9a0e714e252e9f8f1007fd4db88d5731912c4ef4bc75d42763470b2feb353d93",
    shouldContainQuestionTool: false,
  },
]

describe("Prometheus prompt byte exactness", () => {
  test("#given captured Prometheus prompt baselines #then every variant keeps the same bytes", () => {
    for (const baseline of PROMETHEUS_PROMPT_BASELINES) {
      const prompt = getPrometheusPrompt(baseline.model, baseline.disabledTools)

      expect(prompt.length, baseline.name).toBeGreaterThan(0)
      expect(hashPrompt(prompt), baseline.name).toBe(baseline.sha256)
    }
  })

  test("#given Question tool availability changes #then Question examples follow disabledTools", () => {
    for (const baseline of PROMETHEUS_PROMPT_BASELINES) {
      const prompt = getPrometheusPrompt(baseline.model, baseline.disabledTools)

      expect(prompt.includes("Question({"), baseline.name).toBe(baseline.shouldContainQuestionTool)
    }
  })
})

function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex")
}
