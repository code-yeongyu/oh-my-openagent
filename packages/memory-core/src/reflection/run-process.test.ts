import { describe, expect, test } from "bun:test"

import { classifyRecordedProcess, classifyRecordedProcessLenient } from "./run-process"

const dead = () => "dead" as const
const alive = () => "alive" as const

describe("recorded process classifiers (DESIGN.r2 4.3, C20-C22 controls)", () => {
  test.each([
    ["a dead pid with no recorded start", 7, undefined, dead, "unknown", "dead"],
    ["a dead pid with a null recorded start", 7, null, dead, "dead", "dead"],
    ["a live pid with no recorded start", 7, undefined, alive, "unknown", "unknown"],
    ["no recorded pid", undefined, undefined, dead, "absent", "absent"],
  ] as const)(
    "#given %s #when classified strictly and leniently #then only the lenient classifier reads a vanished pid as dead",
    async (_name, pid, start, liveness, strict, lenient) => {
      // given
      const seams = { getPidLiveness: liveness, getProcessStartIdentity: async () => "proc-start-epoch:1" }

      // when
      const verdicts = [
        await classifyRecordedProcess(pid, start, seams),
        await classifyRecordedProcessLenient(pid, start, seams),
      ]

      // then
      expect(verdicts).toEqual([strict, lenient])
    },
  )

  test("#given a live pid whose recorded start belongs to another process #when classified #then both classifiers prove reuse", async () => {
    // given
    const seams = { getPidLiveness: alive, getProcessStartIdentity: async () => "proc-start-epoch:2" }

    // when
    const verdicts = [
      await classifyRecordedProcess(7, "proc-start-epoch:1", seams),
      await classifyRecordedProcessLenient(7, "proc-start-epoch:1", seams),
    ]

    // then
    expect(verdicts).toEqual(["dead", "dead"])
  })
})
