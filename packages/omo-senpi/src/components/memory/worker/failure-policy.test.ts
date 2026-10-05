import { describe, expect, test } from "bun:test"

import { classifyReflectionFailure } from "./failure-policy"

describe("reflection failure classification for the park policy", () => {
  test.each([
    ["merged", undefined, undefined],
    ["no_changes", undefined, undefined],
  ] as const)("#given a %s outcome #when classified #then there is no failure signal", (outcome, reason, detail) => {
    expect(classifyReflectionFailure({ outcome, reason, detail })).toBeUndefined()
  })

  test.each([
    ["timed_out", "deadline_exceeded", undefined],
    ["failed", "child_exit", 'OpenAI API error (429): {"type":"usage_limit_reached"}'],
    ["failed", "spawn_failed", "provider_unavailable:OpenAI API error (429): Too Many Requests"],
    ["failed", "child_exit", '503: {"message":"All providers are temporarily cooling down"}'],
    ["failed", "child_exit", "Error: EAGAIN: resource temporarily unavailable, posix_spawn"],
    ["failed", "child_exit", "Error: connect ECONNRESET"],
    ["failed", "child_exit", "Error: request to https://api.example failed, reason: ETIMEDOUT"],
    ["failed", "supervisor_failed", "reflection supervisor died before publishing an outcome; the child is dead too\nsupervisor pid 1, child pid 2"],
    ["parent_dirty", undefined, undefined],
    ["merge_conflict", undefined, "Recorded preimage for 'reference/lessons/operating-lessons.md'"],
    ["failed", undefined, undefined],
  ] as const)("#given %s/%s with detail %p #when classified #then the failure is retryable", (outcome, reason, detail) => {
    const signal = classifyReflectionFailure({ outcome, reason, detail })
    expect(signal?.retryable).toBe(true)
    expect(signal?.fingerprint.length ?? 0).toBeGreaterThan(0)
  })

  test.each([
    ["failed", "spawn_failed", 'Error: Model "apitopia/kimi-for-coding-highspeed" not found. Use --list-models to see available models.'],
    ["failed", "spawn_failed", "memory reflection exhausted every quick candidate"],
    ["failed", "child_exit", "No API key found for zai.\n\nUse /login to log into a provider"],
    ["failed", "child_exit", "ENOENT: no such file or directory, open '/home/u/.omo/binary-runtime/0.0.0-omob.x/dist/modes/interactive/theme/dark.json'"],
    ["failed", "child_exit", "sandbox-exec: execvp() of 'senpi' failed: No such file or directory"],
    ["failed", "supervisor_failed", "memory run supervisor exited with 0"],
    ["failed", "invalid_target", "Dream changed paths outside targetDoc"],
    ["failed", "completion_validation", "Git administration file was altered"],
    ["dirty_uncommitted", "completion_validation", "worktree has uncommitted changes"],
    ["failed", "missing_validated_tip", undefined],
    ["failed", "missing_worktree", undefined],
  ] as const)("#given %s/%s with detail %p #when classified #then the failure is not retryable", (outcome, reason, detail) => {
    const signal = classifyReflectionFailure({ outcome, reason, detail })
    expect(signal?.retryable).toBe(false)
  })

  test("#given two failures whose stderr differs only in stack frames #when classified #then they share a fingerprint", () => {
    const first = classifyReflectionFailure({ outcome: "failed", reason: "child_exit", detail: "345 |   dark: JSON.parse(x)\nENOENT: no such file or directory, open '/a/dark.json'\n    at load (/a/theme.js:345:33)" })
    const second = classifyReflectionFailure({ outcome: "failed", reason: "child_exit", detail: "346 |   dark: JSON.parse(x)\nENOENT: no such file or directory, open '/a/dark.json'\n    at load (/a/theme.js:346:33)" })
    expect(first?.fingerprint).toBe(second?.fingerprint)
  })

  test("#given a failure with a long detail #when classified #then the signal carries reason and a bounded detail", () => {
    const signal = classifyReflectionFailure({ outcome: "failed", reason: "child_exit", detail: "x".repeat(5_000) })
    expect(signal?.reason).toBe("child_exit")
    expect(signal?.detail?.length ?? 0).toBeLessThanOrEqual(512)
  })
})
