import { describe, expect, test } from "bun:test"

import { classifyChildExit, mapExitOutcomeToError, tailStderr } from "./exit-mapping"

describe("classifyChildExit", () => {
  test("#given a spawn error #when classifying #then it is a spawn_error outcome", () => {
    // when
    const outcome = classifyChildExit({ code: null, signal: null, error: new Error("ENOENT"), pid: undefined, stderr: "" })

    // then
    expect(outcome.kind).toBe("spawn_error")
    if (outcome.kind === "spawn_error") {
      expect(outcome.message).toContain("ENOENT")
    }
  })

  test("#given an exit by signal #when classifying #then it is killed with the signal recorded", () => {
    // when
    const outcome = classifyChildExit({ code: null, signal: "SIGKILL", pid: 4321, stderr: "" })

    // then
    expect(outcome.kind).toBe("killed")
    expect(outcome.facts.signal).toBe("SIGKILL")
    expect(outcome.facts.pid).toBe(4321)
  })

  test("#given a zero exit code #when classifying #then it is clean", () => {
    // when / then
    expect(classifyChildExit({ code: 0, signal: null, pid: 1, stderr: "" }).kind).toBe("clean")
  })

  test("#given a nonzero exit code #when classifying #then it is crashed and stderr tail is capped at 4KB", () => {
    // given
    const stderr = "x".repeat(5000)

    // when
    const outcome = classifyChildExit({ code: 3, signal: null, pid: 9, stderr })

    // then
    expect(outcome.kind).toBe("crashed")
    expect(outcome.facts.code).toBe(3)
    expect(outcome.facts.stderrTail.length).toBe(4096)
  })
})

describe("tailStderr", () => {
  test("#given text longer than the cap #when tailing #then it keeps the last cap characters", () => {
    // when / then
    expect(tailStderr("abcdef", 4)).toBe("cdef")
    expect(tailStderr("ab", 4)).toBe("ab")
  })
})

describe("mapExitOutcomeToError", () => {
  test("#given a killed child that has NOT reached terminal #when mapping #then status error with killed:true and exit facts", () => {
    // given
    const outcome = classifyChildExit({ code: null, signal: "SIGKILL", pid: 77, stderr: "" })

    // when
    const mapped = mapExitOutcomeToError(outcome, { alreadyTerminal: false })

    // then
    expect(mapped).not.toBeNull()
    expect(mapped?.status).toBe("error")
    expect(mapped?.killed).toBe(true)
    expect(mapped?.exit.signal).toBe("SIGKILL")
    expect(mapped?.exit.pid).toBe(77)
    expect(mapped?.error_message).toContain("SIGKILL")
  })

  test("#given a nonzero exit before terminal #when mapping #then status error carries the stderr tail, not killed", () => {
    // given
    const outcome = classifyChildExit({ code: 2, signal: null, pid: 5, stderr: "boom failure" })

    // when
    const mapped = mapExitOutcomeToError(outcome, { alreadyTerminal: false })

    // then
    expect(mapped?.status).toBe("error")
    expect(mapped?.killed).toBe(false)
    expect(mapped?.error_message).toContain("boom failure")
  })

  test("#given an exit AFTER a terminal state #when mapping #then it is resident teardown with no status change", () => {
    // given
    const outcome = classifyChildExit({ code: 0, signal: null, pid: 5, stderr: "" })

    // when / then
    expect(mapExitOutcomeToError(outcome, { alreadyTerminal: true })).toBeNull()
  })
})
