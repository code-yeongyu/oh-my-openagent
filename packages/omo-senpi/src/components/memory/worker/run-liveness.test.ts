import { describe, expect, test } from "bun:test"

import { classifyRunProcess, isLauncherDead } from "./run-liveness"

const alive = () => "alive" as const
const dead = () => "dead" as const

describe("run process liveness across start-identity schemes", () => {
  test("#given a live pid recorded with ps-lstart and read back as proc-start-epoch #when classified #then the mismatch is not pid reuse and the process is alive", async () => {
    // given
    const recorded = "ps-lstart:Tue Sep 15 14:59:03 2026"
    const actual = "proc-start-epoch:1789452000"

    // when
    const verdict = await classifyRunProcess(222, recorded, {
      getPidLiveness: alive,
      getProcessStartIdentity: async () => actual,
    })

    // then
    expect(verdict).toBe("alive")
  })

  test("#given a live pid whose recorded and actual identities share a scheme but differ #when classified #then the pid was reused and the process is dead", async () => {
    // given
    const recorded = "proc-start-epoch:1789452000"
    const actual = "proc-start-epoch:1789455600"

    // when
    const verdict = await classifyRunProcess(222, recorded, {
      getPidLiveness: alive,
      getProcessStartIdentity: async () => actual,
    })

    // then
    expect(verdict).toBe("dead")
  })

  test("#given a live pid with a matching identity #when classified #then it is alive", async () => {
    // when
    const verdict = await classifyRunProcess(222, "proc-start-epoch:1789452000", {
      getPidLiveness: alive,
      getProcessStartIdentity: async () => "proc-start-epoch:1789452000",
    })

    // then
    expect(verdict).toBe("alive")
  })

  test("#given a pid the kernel no longer knows #when classified #then it is dead regardless of the recorded scheme", async () => {
    // when
    const verdict = await classifyRunProcess(222, "ps-lstart:Tue Sep 15 14:59:03 2026", {
      getPidLiveness: dead,
      getProcessStartIdentity: async () => null,
    })

    // then
    expect(verdict).toBe("dead")
  })

  test("#given scheme-less legacy identities that differ #when classified #then raw inequality still means pid reuse", async () => {
    // when
    const verdict = await classifyRunProcess(222, "supervisor-start", {
      getPidLiveness: alive,
      getProcessStartIdentity: async () => "different-start",
    })

    // then
    expect(verdict).toBe("dead")
  })

  test("#given a live launcher recorded with ps-lstart and read back as proc-start-epoch #when probed #then the launcher is not dead", async () => {
    // when
    const verdict = await isLauncherDead(111, "ps-lstart:Tue Sep 15 14:59:03 2026", {
      getPidLiveness: alive,
      getProcessStartIdentity: async () => "proc-start-epoch:1789452000",
    })

    // then
    expect(verdict).toBe(false)
  })

  test("#given a live launcher pid reused by another process in the same scheme #when probed #then the launcher is dead", async () => {
    // when
    const verdict = await isLauncherDead(111, "proc-start-epoch:1789452000", {
      getPidLiveness: alive,
      getProcessStartIdentity: async () => "proc-start-epoch:1789455600",
    })

    // then
    expect(verdict).toBe(true)
  })
})
