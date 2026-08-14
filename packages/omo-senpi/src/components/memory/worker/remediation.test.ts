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

  describe("#given a sandbox grant no writer has created", () => {
    test("#given an ENOENT naming a path #when advising #then it names that path instead of blaming the senpi executable", () => {
      // given the failure a missing sandbox write grant produces
      const detail = "ENOENT: no such file or directory, lstat '/Users/ivan/.omo/memory/agents/para-8ba08a5b/runtime/reflection-sessions'"

      // when
      const advice = reflectionRemediation("spawn_failed", detail)

      // then
      expect(advice).toContain("/Users/ivan/.omo/memory/agents/para-8ba08a5b/runtime/reflection-sessions")
      expect(advice).not.toContain("SENPI_BIN")
    })

    test("#given a spawn failure with no path #when advising #then the executable hint still stands", () => {
      // given
      const detail = "spawn senpi ENOENT"

      // when
      const advice = reflectionRemediation("spawn_failed", detail)

      // then
      expect(advice).toContain("SENPI_BIN")
    })

    test("#given a model visibility failure #when advising #then the category hint wins over the path hint", () => {
      // given
      const advice = reflectionRemediation("model_not_visible", "model not found")

      // then
      expect(advice).toContain("memory.reflection")
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
  })
})
