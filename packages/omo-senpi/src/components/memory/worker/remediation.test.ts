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
        'Reflection category "quick" could not resolve a usable model (cause: model_unavailable); missing providers: kimi-coding, openai-codex',
      )

      // then
      expect(hint).toContain("categories.")
      expect(hint).toContain("/login")
      expect(hint).not.toContain("child-stderr.log")
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

  describe("#given a bubblewrap sandbox setup failure", () => {
    // bwrap dies inside its own setup, before the reflection child exists, and the run directory
    // is already pruned by the time the hint is rendered - so child-stderr.log is a dead pointer.
    test("#when remediated #then the hint names the sandbox setting instead of the deleted child log", () => {
      // when
      const hint = reflectionRemediation("child_exit", "bwrap: setting up uid map: Permission denied")

      // then
      expect(hint).toContain("memory.reflection.sandbox")
      expect(hint).not.toContain("child-stderr.log")
    })

    test("#when the uid-map denial arrives without the bwrap prefix #then the sandbox hint still fires", () => {
      // when
      const hint = reflectionRemediation("child_exit", "setting up uid map: Permission denied")

      // then
      expect(hint).toContain("memory.reflection.sandbox")
      expect(hint).not.toContain("child-stderr.log")
    })

    test("#when bwrap fails setting up the namespace itself #then the sandbox hint fires and offers the host fix", () => {
      // when
      const hint = reflectionRemediation("child_exit", "bwrap: setting up namespace: Operation not permitted")

      // then
      expect(hint).toContain("memory.reflection.sandbox")
      expect(hint).toContain("user namespace")
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
