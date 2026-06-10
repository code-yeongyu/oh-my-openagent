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
