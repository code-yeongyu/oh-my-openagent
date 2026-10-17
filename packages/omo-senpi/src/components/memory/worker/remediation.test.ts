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
        'Reflection category "quick" could not resolve a usable model (cause: model_unavailable); missing providers: kimi-coding, chatgpt-subscription',
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

    test("#when a real user-namespace error is remediated #then the host fix comes first and disabling the sandbox is only a last resort", () => {
      // when
      const hint = reflectionRemediation("child_exit", "bwrap: No permissions to creating new namespace, likely because the kernel does not allow non-privileged user namespaces. See https://deb.li/bubblewrap or https://deb.li/bubblewrap-sysctl.")

      // then
      expect(hint).toContain("user namespace")
      expect(hint.indexOf("allow unprivileged user namespaces")).toBeGreaterThanOrEqual(0)
      expect(hint.indexOf("allow unprivileged user namespaces")).toBeLessThan(hint.indexOf("memory.reflection.sandbox"))
      expect(hint).toContain("last resort")
    })

    test("#when bwrap cannot find a bind source path #then it names the missing directory and never blames user namespaces or suggests turning the sandbox off (#10317)", () => {
      // when
      const hint = reflectionRemediation("child_exit", "bwrap: Can't find source path /home/u/.omo/memory/agents/a1/runtime/reflection-sessions: No such file or directory")

      // then
      expect(hint).toContain("/home/u/.omo/memory/agents/a1/runtime/reflection-sessions")
      expect(hint).toContain("mkdir")
      expect(hint).not.toContain("user namespace")
      expect(hint).not.toContain("memory.reflection.sandbox")
      expect(hint).not.toContain("\"off\"")
    })

    // Verbatim bwrap output (bubblewrap.c: die() prints "bwrap: <msg>", die_with_error() appends ": <strerror>").
    // Released 0.4-0.9 say "No permissions to creating new namespace"; main says "create a new namespace".
    const REAL_USERNS_REFUSALS = [
      "bwrap: No permissions to creating new namespace, likely because the kernel does not allow non-privileged user namespaces. On e.g. debian this can be enabled with 'sysctl kernel.unprivileged_userns_clone=1'.",
      "bwrap: No permissions to create a new namespace, likely because the kernel does not allow non-privileged user namespaces. On e.g. debian this can be enabled with 'sysctl kernel.unprivileged_userns_clone=1'.",
      "bwrap: Creating new namespace failed, likely because the kernel does not support user namespaces.  bwrap must be installed setuid on such systems.",
      "bwrap: Creating new namespace failed: nesting depth or /proc/sys/user/max_*_namespaces exceeded (ENOSPC)",
      "bwrap: Creating new namespace failed: No space left on device",
      "bwrap: Creating new namespace failed: Operation not permitted",
      "bwrap: setting up uid map: Permission denied",
      "bwrap: setting up gid map: Permission denied",
    ]
    for (const message of REAL_USERNS_REFUSALS) {
      test(`#when bwrap prints the real user-namespace refusal ${JSON.stringify(message.slice(0, 60))} #then the host fix comes first and "off" is only a last resort`, () => {
        // when
        const hint = reflectionRemediation("child_exit", message)

        // then
        expect(hint).toContain("allow unprivileged user namespaces")
        expect(hint.indexOf("allow unprivileged user namespaces")).toBeLessThan(hint.indexOf("memory.reflection.sandbox"))
        expect(hint).toContain("last resort")
      })
    }

    test("#when the missing bind source path contains spaces #then the whole path is named and quoted in the mkdir advice", () => {
      // when
      const hint = reflectionRemediation("child_exit", "bwrap: Can't find source path /home/u/My Memory/runtime/reflection-sessions: No such file or directory")

      // then
      expect(hint).toContain("mkdir -p '/home/u/My Memory/runtime/reflection-sessions'")
      expect(hint).not.toContain("user namespace")
    })

    test("#when the missing bind source path contains a single quote #then the mkdir advice still names exactly that path when pasted into a shell", () => {
      // when
      const hint = reflectionRemediation("child_exit", "bwrap: Can't find source path /home/u/it's mine/runtime/reflection-sessions: No such file or directory")

      // then
      expect(hint).toContain("mkdir -p '/home/u/it'\\''s mine/runtime/reflection-sessions'")
    })

    test("#when bwrap fails for an unrelated reason #then it does not blame user namespaces or suggest turning the sandbox off", () => {
      // when
      const hint = reflectionRemediation("child_exit", "bwrap: execvp senpi: Permission denied")

      // then
      expect(hint).not.toContain("user namespace")
      expect(hint).not.toContain("\"off\"")
    })
  })

  describe("#given a model-admission exhaustion reported as spawn_failed", () => {
    // `MemoryModelExhaustedError` is finalized with reason `spawn_failed` (run-finalization
    // `overrideFailedReservationRun`, and runner-execution's pre-ledger branch), but NO child was
    // ever spawned and no executable was ever resolved. Its detail always carries the
    // `attempted:<models>` roster that `formatMemoryModelExhaustion` appends, which is the only
    // marker separating it from a real executable-resolution failure.
    const attempted = "attempted:openai/gpt-5.6-luna-fast,apitopia/kimi-for-coding-highspeed,anthropic/claude-haiku-4-5"

    test("#when every candidate was rate limited #then the hint names the provider outage instead of SENPI_BIN", () => {
      // given: the verbatim detail a parked identity recorded when all three candidates were refused
      const detail = `provider_unavailable:OpenAI API error (429): {"type":"usage_limit_reached","message":"The usage limit has been reached"} | 503: {"message":"All providers are temporarily cooling down"} | {"type":"error","error":{"type":"rate_limit_error","message":"All tokens rate limited"}}; ${attempted}`

      // when
      const hint = reflectionRemediation("spawn_failed", detail)

      // then
      expect(hint).toContain("provider")
      expect(hint).toContain("/reflect")
      expect(hint).not.toContain("SENPI_BIN")
      expect(hint).not.toContain("child-stderr.log")
    })

    test("#when a candidate had no credentials #then the login hint fires instead of SENPI_BIN", () => {
      // given: the auth_missing arm of the same exhaustion format, which the spawn_failed branch shadowed
      const hint = reflectionRemediation("spawn_failed", `auth_missing:chatgpt-subscription,kimi-coding; ${attempted}`)

      // then
      expect(hint).toContain("/login")
      expect(hint).not.toContain("SENPI_BIN")
    })

    test("#when the prompt overflowed every candidate #then the hint names the context escape hatches", () => {
      // given: context_overflow had no branch at all and fell through to the child log
      const hint = reflectionRemediation("spawn_failed", `context_overflow:prompt is 412000 tokens, limit is 272000; ${attempted}`)

      // then
      expect(hint).toContain("memory.reflection")
      expect(hint).not.toContain("SENPI_BIN")
      expect(hint).not.toContain("child-stderr.log")
    })

    test("#when the exhaustion kind is unrecognized #then it still avoids SENPI_BIN and the nonexistent child log", () => {
      // given: a future miss kind, still carrying the roster marker
      const hint = reflectionRemediation("spawn_failed", `something_new:upstream said no; ${attempted}`)

      // then
      expect(hint).not.toContain("SENPI_BIN")
      expect(hint).not.toContain("child-stderr.log")
    })
  })

  describe("#given the pre-existing failure taxonomies", () => {
    test("#when the child could not see the model #then the category/model hint is kept", () => {
      expect(reflectionRemediation("child_exit", "Model not found: apitopia/kimi")).toContain("memory.reflection")
    })

    test("#when spawn failed #then the SENPI_BIN hint is kept", () => {
      expect(reflectionRemediation("spawn_failed", "execvp ENOENT")).toContain("SENPI_BIN")
    })

    test("#when no launcher could be resolved at all #then the SENPI_BIN hint is kept", () => {
      // given: the verbatim throw from senpi-command `resolveSenpiLaunch`, which carries no model roster
      expect(reflectionRemediation("spawn_failed", "Unable to resolve a runnable Senpi launcher")).toContain("SENPI_BIN")
    })

    test("#when a running child dies on a missing file #then the hint points at the child log, not SENPI_BIN", () => {
      // given: the child started, so the executable resolved; only a file it opened was missing
      const detail = "ENOENT: no such file or directory, open '/opt/omo-runtime/dist/modes/interactive/theme/dark.json'"

      // when
      const hint = reflectionRemediation("child_exit", detail)

      // then
      expect(hint).not.toContain("SENPI_BIN")
      expect(hint).toContain("child-stderr.log")
    })

    test("#when nothing matches #then the child log hint remains the default for post-spawn failures", () => {
      expect(reflectionRemediation("child_exit", "exit code 1")).toContain("child-stderr.log")
    })
  })
})
