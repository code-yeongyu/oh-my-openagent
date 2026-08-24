import { describe, expect, test } from "bun:test"

import { reflectionRemediation } from "./remediation"

describe("reflectionRemediation", () => {
  describe("#given a category_unavailable failure", () => {
    // No child was ever spawned for a pre-spawn resolution failure, so the hint must never
    // point at runtime/reflection-sessions/<runId>/child-stderr.log (that file does not exist).
    test("#when remediated #then it names the config escape hatches instead of a nonexistent child log", () => {
      // when
      const hint = reflectionRemediation(
        "category_unavailable",
        'Reflection category "quick" could not resolve a usable model (cause: model_unavailable); missing providers: kimi-coding, quotio-openai',
      )

      // then
      expect(hint).toContain("categories.")
      expect(hint).toContain("/login")
      expect(hint).not.toContain("child-stderr.log")
    })
  })

  describe("#given a provider 400 rejecting reasoning.effort", () => {
    // Verbatim stderr from three consecutive real reflection runs against gpt-5.6-luna.
    // It matched no taxonomy, so a pure capability mismatch was reported with the generic
    // "inspect child-stderr.log" hint - and that log contains only this same line.
    test("#when remediated #then it names the rejected parameter instead of the child log", () => {
      // when
      const hint = reflectionRemediation(
        "child_exit",
        'OpenAI API error (400): {"message":"Unsupported value: \'minimal\' is not supported with the \'gpt-5.6-luna\' model. Supported values are: \'none\', \'low\', \'medium\', \'high\', \'xhigh\', and \'max\'.","type":"invalid_request_error","param":"reasoning.effort","code":"unsupported_value"}',
      )

      // then
      expect(hint).toContain("reasoning effort")
      expect(hint).not.toContain("child-stderr.log")
    })
  })

  describe("#given an unsupported_value for a parameter other than reasoning", () => {
    // The reasoning hint must not be handed out for every unsupported_value: a
    // temperature or max_tokens rejection needs the generic child-log path instead.
    test("#when remediated #then it does not recommend changing the reasoning level", () => {
      // when
      const hint = reflectionRemediation(
        "child_exit",
        'OpenAI API error (400): {"message":"Unsupported value: 0.9 is not supported with this model.","param":"temperature","code":"unsupported_value"}',
      )

      // then
      expect(hint).not.toContain("reasoning")
      expect(hint).toContain("child-stderr.log")
    })
  })

  describe("#given the senpi child's verbatim model-not-found error", () => {
    // The child prints: Error: Model "<selector>" not found. Use --list-models to see available models.
    // That wording matched no taxonomy, so a repeating model miss was reported with the generic
    // "inspect child-stderr.log" hint that never names the actual cause.
    test("#when remediated #then it names the model the child could not see instead of the generic child log", () => {
      // when
      const hint = reflectionRemediation(
        "child_exit",
        'Error: Model "apitopia/z-ai/glm-5.2-ultrafast-unlocked" not found. Use --list-models to see available models.',
      )

      // then
      expect(hint).toContain("memory.reflection")
      expect(hint).not.toContain("child-stderr.log")
    })
  })

  describe("#given a pressure dream budget warning", () => {
    test("#when remediated #then it tells the next run to trim system memory below the supplied target", () => {
      expect(reflectionRemediation("budget_not_met", "Committed system/ estimate is 90 tokens; pressure dream target is below 80 tokens"))
        .toBe("run /dream again and trim or demote the largest system/ files until the committed estimate is below $SYSTEM_TOKEN_TARGET")
    })
  })

  describe("#given the pre-existing failure taxonomies", () => {
    test("#when the child could not see the model #then the category/model hint is kept", () => {
      expect(reflectionRemediation("child_exit", "Model not found: apitopia/kimi")).toContain("memory.reflection")
    })

    test("#when spawn failed #then the SENPI_BIN hint is kept", () => {
      expect(reflectionRemediation("spawn_failed", "execvp ENOENT")).toContain("SENPI_BIN")
    })

    test("#when nothing matches #then the child log hint remains the default for post-spawn failures", () => {
      expect(reflectionRemediation("child_exit", "exit code 1")).toContain("child-stderr.log")
    })

    // The run dir is `runtime/reflection/runs/<runId>` (reflection-spawn-input.ts builds it from
    // `paths.reflection` + "runs"). The hint used to name `runtime/reflection-sessions/<runId>`,
    // a vestigial layout entry nothing ever writes to, sending readers to a nonexistent file.
    test("#when the default child-log hint is emitted #then it names the directory the run actually writes", () => {
      const hint = reflectionRemediation("child_exit", "exit code 1")

      expect(hint).toBe("inspect runtime/reflection/runs/<runId>/child-stderr.log")
      expect(hint).not.toContain("reflection-sessions")
    })
  })
})
