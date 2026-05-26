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
    sha256: "7cd6dcc764c4b6c7cca61cf3878a1a2b2fb91836b38cbd0ed348d3e778cea4d9",
    shouldContainQuestionTool: true,
  },
  {
    name: "default-question-disabled",
    model: undefined,
    disabledTools: ["question"],
    sha256: "db181638b60c222e5238daa8c090b8b908235d4a1cef7ff760839d4200195f59",
    shouldContainQuestionTool: false,
  },
  {
    name: "gpt-enabled",
    model: "gpt-5.5",
    disabledTools: [],
    sha256: "95e42fb8112a6aac3d702fa40ec4a8f89923acd239e1041646ed5a0fd2a9feb9",
    shouldContainQuestionTool: true,
  },
  {
    name: "gpt-question-disabled",
    model: "gpt-5.5",
    disabledTools: ["question"],
    sha256: "8792637920d271caec5675e63ed6685b1e5e6e292824fd6cf3f9a699e83a42fe",
    shouldContainQuestionTool: false,
  },
  {
    name: "gemini-enabled",
    model: "gemini-3.1-pro",
    disabledTools: [],
    sha256: "df846993f69aef852bfe14569231453c673d369d69229f6e67f5af0915c05a1d",
    shouldContainQuestionTool: true,
  },
  {
    name: "gemini-question-disabled",
    model: "gemini-3.1-pro",
    disabledTools: ["question"],
    sha256: "f9f9b7498c681a7d98a388a2e2aaf875227a145b4f824277ef54ed3a8d80106b",
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
