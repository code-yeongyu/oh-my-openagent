import { describe, expect, test } from "bun:test"

import { answerFromProcOrLsof } from "./open-file-holders"

// omo #10199 r5 delta review MEDIUM (Linux platform contract): the /proc scans stat every process's
// fd targets and cwd, and a stat on a hung NFS or dead FUSE mount never returns. The sweep runs
// under the memory-write lock, so an unbounded scan stalls every writer of the identity. The scan
// is raced against the same bound as lsof; a scan that has not answered by then is UNKNOWN
// (held), and lsof is not consulted, because lsof reads the same /proc and would hang the same way.
// A scan that never settles is the behavior under test, so it is a promise that never resolves.

describe("Linux /proc scans are bounded", () => {
  test.skipIf(process.platform !== "linux")("#given a /proc scan that never answers #when the bound passes #then the answer is unknown and lsof is not asked", async () => {
    // #given
    let lsofAsked = false
    const neverAnswers = () => new Promise<never>(() => undefined)

    // #when
    const answer = await answerFromProcOrLsof(neverAnswers, async () => {
      lsofAsked = true
      return []
    }, 500)

    // #then
    expect(answer).toBeNull()
    expect(lsofAsked).toBe(false)
  }, 10_000)
})
