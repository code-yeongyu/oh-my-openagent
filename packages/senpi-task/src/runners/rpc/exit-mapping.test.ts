import { describe, expect, test } from "bun:test"

import { classifyChildExit, mapExitOutcomeToError, tailStderr } from "./exit-mapping"

/** The sentence senpi's startHostChildReaper writes on Bun for Windows (packages/coding-agent/src/modes/rpc/child-reaper.ts). */
const REAPER_ADVISORY = "child reaper unavailable under Bun on win32: children orphaned by a terminated worker thread stay as zombies until this host exits"

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

  test("#given a Windows external termination (code 1, no signal, no stderr) #when classifying #then it is killed", () => {
    // given: Windows TerminateProcess yields exit code 1 with NO signal provenance
    // and leaves the child's stderr buffer empty (nothing was written before death).

    // when
    const outcome = classifyChildExit({ code: 1, signal: null, pid: 6664, stderr: "", platform: "win32" })

    // then
    expect(outcome.kind).toBe("killed")
    expect(outcome.facts.code).toBe(1)
    expect(outcome.facts.signal).toBeNull()
  })

  test("#given only the Bun Windows child-reaper startup advisory #when a child exits with code 1 #then it is killed", () => {
    // The Windows driver captures this prefix; its error_excerpt truncates the rest.
    const stderr = "child reaper unavailable under Bun on win32: children orphaned by a terminated worker thread stay as zombies until this "
    const outcome = classifyChildExit({ code: 1, signal: null, pid: 2784, stderr, platform: "win32" })

    expect(outcome.kind).toBe("killed")
    expect(mapExitOutcomeToError(outcome, { alreadyTerminal: false })?.killed).toBe(true)
  })

  test("#given N Bun Windows child-reaper advisory lines #when a child exits with code 1 #then every advisory-only count is killed", () => {
    for (const count of [1, 2, 4]) {
      const outcome = classifyChildExit({ code: 1, signal: null, pid: 2784, stderr: `${Array.from({ length: count }, () => REAPER_ADVISORY).join("\n")}\n`, platform: "win32" })
      expect(outcome.kind).toBe("killed")
      expect(mapExitOutcomeToError(outcome, { alreadyTerminal: false })?.killed).toBe(true)
    }
  })

  // Bun prints the advisory once per terminated worker thread, and the handle classifies the 4KB tail
  // of the child's stderr (client.stderrTail): with enough advisories that tail starts mid-line.
  test("#given more Bun Windows advisories than the 4KB stderr tail holds #when a killed child exits with code 1 #then it is still killed", () => {
    const advisory = "child reaper unavailable under Bun on win32: children orphaned by a terminated worker thread stay as zombies until this host exits"
    const stderr = tailStderr(`${Array.from({ length: 40 }, () => advisory).join("\n")}\n`)

    const outcome = classifyChildExit({ code: 1, signal: null, pid: 6304, stderr, platform: "win32" })

    expect(stderr.startsWith(advisory)).toBe(false)
    expect(outcome.kind).toBe("killed")
    expect(mapExitOutcomeToError(outcome, { alreadyTerminal: false })?.killed).toBe(true)
  })

  test("#given a Bun Windows advisory the kill cut mid-write #when the child exits with code 1 #then it is still killed", () => {
    const advisory = "child reaper unavailable under Bun on win32: children orphaned by a terminated worker thread stay as zombies until this host exits"
    const stderr = `${advisory}\n${advisory}\nchild reaper unavailable under Bun on wi`

    const outcome = classifyChildExit({ code: 1, signal: null, pid: 6304, stderr, platform: "win32" })

    expect(outcome.kind).toBe("killed")
    expect(mapExitOutcomeToError(outcome, { alreadyTerminal: false })?.killed).toBe(true)
  })

  test("#given a real diagnostic among Bun Windows advisories, whole or cut #when the child exits with code 1 #then it stays crashed", () => {
    const advisory = "child reaper unavailable under Bun on win32: children orphaned by a terminated worker thread stay as zombies until this host exits"
    const advisories = Array.from({ length: 40 }, () => advisory).join("\n")
    // The tail cut a diagnostic line, not an advisory: its fragment ends no advisory line.
    const cutDiagnostic = tailStderr(`${"TypeError: boom ".repeat(300)}\n${advisory}\n`)
    const errorAfterAdvisories = tailStderr(`${advisories}\nTypeError: boom\n`)
    const errorCutMidWrite = `${advisory}\nTypeError: bo`

    for (const stderr of [cutDiagnostic, errorAfterAdvisories, errorCutMidWrite]) {
      expect(classifyChildExit({ code: 1, signal: null, pid: 6304, stderr, platform: "win32" }).kind).toBe("crashed")
    }
    expect(classifyChildExit({ code: 1, signal: null, pid: 6304, stderr: tailStderr(`${advisories}\n`), platform: "linux" }).kind).toBe("crashed")
  })

  test("#given Bun advisory lines plus one real error line #when classifying #then it stays crashed", () => {
    const stderr = `${REAPER_ADVISORY}\n${REAPER_ADVISORY}\nTypeError: boom\n`

    expect(classifyChildExit({ code: 1, signal: null, pid: 2784, stderr, platform: "win32" }).kind).toBe("crashed")
    expect(classifyChildExit({ code: 1, signal: null, pid: 2784, stderr, platform: "linux" }).kind).toBe("crashed")
  })

  test("#given the dev CI excerpt with the sentence's tail on its own line #when a Windows child exits with code 1 #then it is killed (#9228)", () => {
    // given: dev run 36881640066 recorded this 120-character excerpt and called the kill a crash, so a
    // second stderr line did not start with the advisory; the source sentence's remaining words are the
    // only advisory text that line can hold.
    const devExcerpt = "child reaper unavailable under Bun on win32: children orphaned by a terminated worker thread stay as zombies until this "
    const stderr = `${devExcerpt}\r\nhost exits\r\n`

    // when
    const outcome = classifyChildExit({ code: 1, signal: null, pid: 5908, stderr, platform: "win32" })

    // then
    expect(outcome.kind).toBe("killed")
    expect(mapExitOutcomeToError(outcome, { alreadyTerminal: false })).toMatchObject({ status: "error", killed: true })
  })

  test("#given the advisory sentence split across lines and repeated #when a Windows child exits with code 1 #then it is killed", () => {
    // given: the same source sentence broken at a word, mid-word, and in three pieces, then written again whole
    const splits = [
      "child reaper unavailable under Bun on win32: children orphaned by a terminated worker thread stay as zombies until this\nhost exits",
      "child reaper unavailable under Bun on win32: children orphaned by a terminated worker thread stay as zombies until this ho\nst exits",
      "child reaper unavailable under Bun on win32:\nchildren orphaned by a terminated worker thread\nstay as zombies until this host exits",
    ]

    for (const split of splits) {
      // when
      const outcome = classifyChildExit({ code: 1, signal: null, pid: 2784, stderr: `${split}\n${REAPER_ADVISORY}\n${split}\n`, platform: "win32" })

      // then
      expect(outcome.kind).toBe("killed")
    }
  })

  test("#given the split advisory beside a real crash line #when a Windows child exits with code 1 #then it stays crashed", () => {
    // given: genuine crash output must never hide behind the advisory, wherever it sits
    const split = "child reaper unavailable under Bun on win32: children orphaned by a terminated worker thread stay as zombies until this\nhost exits"
    const crashes = [
      `${split}\npanic: index out of range\n`,
      `panic: index out of range\n${split}\n`,
      `${REAPER_ADVISORY} TypeError: boom\n`,
      `child reaper unavailable under Bun on win32: children orphaned by a terminated worker thread stay as zombies until this\nhost exits with a panic\n`,
      "host exits\n",
      "child reaper unavailable under Bun on win32\n",
    ]

    for (const stderr of crashes) {
      // when / then
      expect(classifyChildExit({ code: 1, signal: null, pid: 2784, stderr, platform: "win32" }).kind).toBe("crashed")
    }
  })

  test("#given a Windows child that crashed on its own #when classifying #then it stays crashed, not killed", () => {
    // given: a genuine crash writes diagnostics to stderr before exiting

    // when
    const outcome = classifyChildExit({ code: 1, signal: null, pid: 7000, stderr: "TypeError: boom", platform: "win32" })

    // then
    expect(outcome.kind).toBe("crashed")
  })

  test("#given a POSIX child exiting with code 1 and no stderr #when classifying #then it stays crashed", () => {
    // given: on POSIX a real kill always carries signal provenance, so a bare
    // code-1 exit must NEVER be reinterpreted as a kill.

    // when
    const outcome = classifyChildExit({ code: 1, signal: null, pid: 8000, stderr: "", platform: "linux" })

    // then
    expect(outcome.kind).toBe("crashed")
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

  test("#given a Windows externally terminated child #when mapping #then status error with killed:true", () => {
    // given: the exact shape observed in issue #6976 (pid 6664, code 1, no signal, no stderr)
    const outcome = classifyChildExit({ code: 1, signal: null, pid: 6664, stderr: "", platform: "win32" })

    // when
    const mapped = mapExitOutcomeToError(outcome, { alreadyTerminal: false })

    // then
    expect(mapped?.status).toBe("error")
    expect(mapped?.killed).toBe(true)
    expect(mapped?.exit.pid).toBe(6664)
  })

  test("#given a Windows child that died on its own #when mapping #then killed stays false", () => {
    // given
    const outcome = classifyChildExit({ code: 1, signal: null, pid: 6665, stderr: "Error: self-inflicted", platform: "win32" })

    // when
    const mapped = mapExitOutcomeToError(outcome, { alreadyTerminal: false })

    // then
    expect(mapped?.killed).toBe(false)
    expect(mapped?.error_message).toContain("self-inflicted")
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
