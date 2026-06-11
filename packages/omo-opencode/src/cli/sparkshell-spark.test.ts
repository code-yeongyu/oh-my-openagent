import { describe, expect, test } from "bun:test"

import {
  buildSparkExecArgs,
  buildSparkSummaryPrompt,
  DEFAULT_SPARK_MODEL,
  DEFAULT_SPARK_TIMEOUT_MS,
  isSparkSummaryEnabled,
  resolveSparkModel,
  resolveSparkTimeoutMs,
  SPARK_PROMPT_OUTPUT_CAP_CHARS,
  type SparkSummaryRequest,
} from "./sparkshell-spark"

function makeRequest(overrides: Partial<SparkSummaryRequest> = {}): SparkSummaryRequest {
  return {
    commandLine: "cat huge.log",
    text: "line one\nline two\n",
    budgetChars: 5000,
    sessionContext: "",
    ...overrides,
  }
}

describe("sparkshell spark prompt", () => {
  test("#given a summary request #when building the prompt #then instructs as-is reproduction, bottom caption, and secret censorship", () => {
    // given
    const request = makeRequest({
      sessionContext: "===== codex session context =====\nfix the fable-fallback.ts regression",
    })

    // when
    const prompt = buildSparkSummaryPrompt(request)

    // then
    expect(prompt).toContain("as-is")
    expect(prompt).toMatch(/never paraphrase|do not paraphrase/i)
    expect(prompt).toContain("[sparkshell caption]")
    expect(prompt).toMatch(/very bottom|at the bottom/i)
    expect(prompt).not.toContain("[REDACTED]")
    expect(prompt).toMatch(/do not (mask|redact|censor)/i)
    expect(prompt).toContain("Command: cat huge.log")
    expect(prompt).toContain("5000")
    expect(prompt).toContain("fix the fable-fallback.ts regression")
    expect(prompt).toContain("line one\nline two")
    expect(prompt).toMatch(/do not run|never run/i)
    expect(prompt).toMatch(/data to summarize, not (directives|instructions)/i)
  })

  test("#given no session context #when building the prompt #then marks the context block as absent", () => {
    // given
    const request = makeRequest({ sessionContext: "" })

    // when
    const prompt = buildSparkSummaryPrompt(request)

    // then
    expect(prompt).toContain("(none)")
  })

  test("#given output beyond the prompt cap #when building the prompt #then embeds head and tail with a truncation marker", () => {
    // given
    const head = "HEAD-SENTINEL-LINE\n"
    const tail = "\nTAIL-SENTINEL-LINE"
    const text = `${head}${"x".repeat(SPARK_PROMPT_OUTPUT_CAP_CHARS * 2)}${tail}`

    // when
    const prompt = buildSparkSummaryPrompt(makeRequest({ text }))

    // then
    expect(prompt).toContain("HEAD-SENTINEL-LINE")
    expect(prompt).toContain("TAIL-SENTINEL-LINE")
    expect(prompt).toContain("chars omitted")
    expect(prompt.length).toBeLessThan(SPARK_PROMPT_OUTPUT_CAP_CHARS + 4000)
  })
})

describe("sparkshell spark gating", () => {
  test("#given env toggles #when checking enablement #then defaults on and honors falsy kill switches", () => {
    expect(isSparkSummaryEnabled({})).toBe(true)
    expect(isSparkSummaryEnabled({ OMO_SPARKSHELL_SPARK: "1" })).toBe(true)
    for (const falsy of ["0", "false", "no", "off", " OFF "]) {
      expect(isSparkSummaryEnabled({ OMO_SPARKSHELL_SPARK: falsy })).toBe(false)
    }
  })

  test("#given model env overrides #when resolving the model #then falls back to the spark default", () => {
    expect(DEFAULT_SPARK_MODEL).toBe("gpt-5.3-codex-spark")
    expect(resolveSparkModel({})).toBe(DEFAULT_SPARK_MODEL)
    expect(resolveSparkModel({ OMO_SPARKSHELL_SPARK_MODEL: "  " })).toBe(DEFAULT_SPARK_MODEL)
    expect(resolveSparkModel({ OMO_SPARKSHELL_SPARK_MODEL: "gpt-5.4-mini" })).toBe("gpt-5.4-mini")
  })

  test("#given timeout env overrides #when resolving the timeout #then ignores junk values", () => {
    expect(resolveSparkTimeoutMs({})).toBe(DEFAULT_SPARK_TIMEOUT_MS)
    expect(resolveSparkTimeoutMs({ OMO_SPARKSHELL_SPARK_TIMEOUT_MS: "12000" })).toBe(12_000)
    expect(resolveSparkTimeoutMs({ OMO_SPARKSHELL_SPARK_TIMEOUT_MS: "junk" })).toBe(DEFAULT_SPARK_TIMEOUT_MS)
    expect(resolveSparkTimeoutMs({ OMO_SPARKSHELL_SPARK_TIMEOUT_MS: "-5" })).toBe(DEFAULT_SPARK_TIMEOUT_MS)
  })

  test("#given exec arg construction #when a codex profile is configured #then injects --profile and keeps stdin prompt mode", () => {
    const defaultArgs = buildSparkExecArgs({}, "/tmp/last-message.txt")
    expect(defaultArgs).toEqual([
      "exec",
      "--model",
      DEFAULT_SPARK_MODEL,
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--ephemeral",
      "--color",
      "never",
      "--output-last-message",
      "/tmp/last-message.txt",
      "-",
    ])

    const profiledArgs = buildSparkExecArgs({ OMO_SPARKSHELL_SPARK_PROFILE: "quotio" }, "/tmp/last-message.txt")
    expect(profiledArgs).toContain("--profile")
    expect(profiledArgs[profiledArgs.indexOf("--profile") + 1]).toBe("quotio")
    expect(profiledArgs[profiledArgs.length - 1]).toBe("-")

    expect(buildSparkExecArgs({ OMO_SPARKSHELL_SPARK_PROFILE: "  " }, "/tmp/last-message.txt")).toEqual(defaultArgs)
  })
})
