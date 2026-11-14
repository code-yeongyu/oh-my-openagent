import { describe, expect, test } from "bun:test"
import { LocalApiError } from "@oh-my-opencode/device-service-core"
import { THREAD_ERROR_CODES } from "../thread/errors"
import { engineCode, exitCodeOf, failureFromError, REMOTE_CODES, remoteFailure } from "./codes"

// The one code list and its mappings are a public contract (design v8-core r2, B1): callers branch on these names and
// the CLI maps them to exit codes, so a renamed, dropped or remapped code is a breaking change.

describe("the remote code list", () => {
  test("#given the thread taxonomy #then the list is it, names unchanged, plus exactly the five new codes", () => {
    expect(REMOTE_CODES.slice(0, THREAD_ERROR_CODES.length)).toEqual([...THREAD_ERROR_CODES])
    expect(THREAD_ERROR_CODES).toHaveLength(42)
    expect(REMOTE_CODES.slice(THREAD_ERROR_CODES.length)).toEqual([
      "timeout",
      "cancelled",
      "session_ended",
      "sender_not_allowed",
      "local_only",
    ])
  })
})

describe("the local API mapping", () => {
  test.each([
    ["handshake_timeout", "host_unavailable"],
    ["closed", "host_unavailable"],
    ["plan_required", "relay_requires_paid_plan"],
    ["session_not_found", "not_found"],
  ] as const)("#given %s #then it answers %s", (local, remote) => {
    expect(failureFromError(new LocalApiError(local, "x"), false).code).toBe(remote)
  })

  test("#given request_timeout #then a read is a plain timeout, a mutator or a command an uncertain one with its command id", () => {
    expect(failureFromError(new LocalApiError("request_timeout", "x"), false)).toMatchObject({ code: "timeout" })
    expect(failureFromError(new LocalApiError("request_timeout", "x"), false).uncertain).toBeUndefined()
    expect(failureFromError(new LocalApiError("request_timeout", "x"), true).uncertain).toBe(true)
    expect(failureFromError(new LocalApiError("request_timeout", "x", { command_id: "c-1" }), false)).toMatchObject({
      code: "timeout",
      uncertain: true,
      command_id: "c-1",
    })
  })

  test("#given a thrown error that is not the local API's #then it is host_unavailable, as data", () => {
    expect(failureFromError(new Error("socket hang up"), false)).toMatchObject({
      kind: "error",
      code: "host_unavailable",
    })
  })
})

describe("the engine mapping (R-05 restored)", () => {
  test("#given the engine's model and level codes #then they keep the model and thinking codes, never invalid_arguments", () => {
    expect(engineCode("model_unavailable").code).toBe("model_not_found")
    expect(engineCode("model_unavailable", ["anthropic/a", "openai/a"])).toEqual({
      code: "model_ambiguous",
      details: { candidates: ["anthropic/a", "openai/a"] },
    })
    expect(engineCode("invalid_level").code).toBe("thinking_level_unsupported")
  })

  test("#given worktree_failed, not_running and handle_lost #then unsupported{worktree}, not_resumable and not_found{handle}", () => {
    expect(engineCode("worktree_failed")).toEqual({ code: "unsupported", details: { feature: "worktree" } })
    expect(engineCode("not_running").code).toBe("not_resumable")
    expect(engineCode("handle_lost")).toEqual({ code: "not_found", details: { kind: "handle" } })
  })
})

describe("exit codes", () => {
  test.each([
    ["host_unavailable", 3],
    ["relay_requires_paid_plan", 3],
    ["session_ended", 4],
    ["timeout", 124],
    ["cancelled", 130],
    ["not_found", 1],
  ] as const)("#given %s #then exit %i", (code, exit) => {
    expect(exitCodeOf(remoteFailure(code, "m", "n"))).toBe(exit)
  })

  test("#given no failure #then exit 0", () => {
    expect(exitCodeOf(undefined)).toBe(0)
  })
})
