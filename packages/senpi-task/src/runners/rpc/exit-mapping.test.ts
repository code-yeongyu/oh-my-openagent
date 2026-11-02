import { describe, expect, test } from "bun:test"

import { classifyChildExit, mapExitOutcomeToError, tailStderr } from "./exit-mapping"

/** Lines a killed Windows child really wrote to stderr in #9471: the Bun reaper advisory, then memory teardown diagnostics. */
const REAPER_ADVISORY = "child reaper unavailable under Bun on win32: children orphaned by a terminated worker thread stay as zombies until this host exits"
const MEMORY_RENAME_EPERM = `${REAPER_ADVISORY}\nmemory shutdown drain step failed {\n  step: "shutdown-evaluator",\n  reason: "quit",\n  error: "Error: EPERM: operation not permitted, rename 'state.json.tmp-1' -> 'state.json'",\n}\n`
const MEMORY_DRAIN_BUDGET = `${REAPER_ADVISORY}\nmemory shutdown drain hit its budget {\n  step: "facts-enqueue",\n  reason: "quit",\n  remainingMs: 0,\n  completedSteps: [ "journal-flush" ],\n}\n`

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

  test("#given a child the runner terminated #when it exits with code 1 and memory teardown lines on stderr #then it is killed", () => {
    // when
    const renameFailure = classifyChildExit({ code: 1, signal: null, pid: 8076, stderr: MEMORY_RENAME_EPERM, terminatedByRunner: true })
    const drainBudget = classifyChildExit({ code: 1, signal: null, pid: 5532, stderr: MEMORY_DRAIN_BUDGET, terminatedByRunner: true })

    // then
    expect(renameFailure.kind).toBe("killed")
    expect(drainBudget.kind).toBe("killed")
    expect(drainBudget.facts.stderrTail).toContain("memory shutdown drain hit its budget")
  })

  test("#given a child the runner terminated that exited cleanly on the signal #when classifying #then it is still killed", () => {
    // when / then
    expect(classifyChildExit({ code: 0, signal: null, pid: 2, stderr: "", terminatedByRunner: true }).kind).toBe("killed")
  })

  test("#given a child that exits on its own and writes 'killed' #when classifying #then it is crashed, not killed", () => {
    // given: stderr text never decides a kill
    const stderr = "Error: the child was killed by its supervisor\n"

    // when
    const outcome = classifyChildExit({ code: 1, signal: null, pid: 7000, stderr })

    // then
    expect(outcome.kind).toBe("crashed")
  })

  test("#given an external termination the runner did not issue (Windows: code 1, no signal, no stderr) #when classifying #then it is crashed", () => {
    // given: Windows reports TerminateProcess as a plain exit code, indistinguishable from a crash
    const outcome = classifyChildExit({ code: 1, signal: null, pid: 6664, stderr: "" })

    // then
    expect(outcome.kind).toBe("crashed")
  })

  test("#given an external termination that only left the Bun reaper advisory #when classifying #then it is crashed", () => {
    // when / then
    expect(classifyChildExit({ code: 1, signal: null, pid: 2784, stderr: `${REAPER_ADVISORY}\n` }).kind).toBe("crashed")
  })

  test("#given a spawn error on a child the runner was terminating #when classifying #then the spawn error wins", () => {
    // when / then
    expect(classifyChildExit({ code: null, signal: null, error: new Error("EPERM"), stderr: "", terminatedByRunner: true }).kind).toBe("spawn_error")
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

  test("#given a child the runner terminated #when mapping #then killed:true and the message says the runner stopped it", () => {
    // given
    const outcome = classifyChildExit({ code: 1, signal: null, pid: 6664, stderr: MEMORY_DRAIN_BUDGET, terminatedByRunner: true })

    // when
    const mapped = mapExitOutcomeToError(outcome, { alreadyTerminal: false })

    // then
    expect(mapped?.status).toBe("error")
    expect(mapped?.killed).toBe(true)
    expect(mapped?.error_message).toBe("RPC child was terminated by its runner (exit code 1, pid=6664)")
  })

  test("#given an external Windows termination #when mapping #then killed:false and the message says the child exited unexpectedly", () => {
    // given
    const outcome = classifyChildExit({ code: 1, signal: null, pid: 6664, stderr: "" })

    // when
    const mapped = mapExitOutcomeToError(outcome, { alreadyTerminal: false })

    // then
    expect(mapped?.status).toBe("error")
    expect(mapped?.killed).toBe(false)
    expect(mapped?.error_message).toBe("RPC child exited unexpectedly (exit code 1)")
    expect(mapped?.error_message).not.toContain("killed")
  })

  test("#given a nonzero exit before terminal #when mapping #then status error names the unexpected exit and keeps the stderr tail, not killed", () => {
    // given
    const outcome = classifyChildExit({ code: 2, signal: null, pid: 5, stderr: "boom failure" })

    // when
    const mapped = mapExitOutcomeToError(outcome, { alreadyTerminal: false })

    // then
    expect(mapped?.status).toBe("error")
    expect(mapped?.killed).toBe(false)
    expect(mapped?.error_message).toBe("RPC child exited unexpectedly (exit code 2)\nboom failure")
    expect(mapped?.exit.stderrTail).toBe("boom failure")
  })

  test("#given a daemon session that ended with a reason and no exit code #when mapping #then the host's reason is the whole message", () => {
    // given: a session exit carries no pid, code or signal; the host's reason rides the stderr tail
    const outcome = { kind: "crashed" as const, facts: { pid: undefined, code: null, signal: null, stderrTail: "transport lost: the connection to the task host dropped and the child did not resume" } }

    // when
    const mapped = mapExitOutcomeToError(outcome, { alreadyTerminal: false })

    // then
    expect(mapped?.killed).toBe(false)
    expect(mapped?.error_message).toBe("transport lost: the connection to the task host dropped and the child did not resume")
  })

  test("#given an exit AFTER a terminal state #when mapping #then it is resident teardown with no status change", () => {
    // given
    const outcome = classifyChildExit({ code: 0, signal: null, pid: 5, stderr: "" })

    // when / then
    expect(mapExitOutcomeToError(outcome, { alreadyTerminal: true })).toBeNull()
  })
})

