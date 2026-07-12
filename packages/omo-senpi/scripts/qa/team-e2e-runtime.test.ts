import { describe, expect, it } from "bun:test"

import * as runtime from "./team-e2e-runtime.mjs"

describe("team e2e process cleanup", () => {
  it("#given completed and live process groups #when cleanup runs #then it skips empty groups and kills concrete survivors", () => {
    // given
    const killed: number[] = []
    const reads = new Map<number, number>([[200, 0]])
    const listGroupPids = (groupId: number): readonly number[] => {
      if (groupId === 100) return []
      const count = reads.get(groupId) ?? 0
      reads.set(groupId, count + 1)
      return count === 0 ? [201, 202] : []
    }

    // when
    const leaked = runtime.cleanupProcessGroups([100, 200], {
      listGroupPids,
      killProcess: (pid: number) => {
        killed.push(pid)
        return true
      },
    })

    // then
    expect(killed).toEqual([201, 202])
    expect(leaked).toBe(0)
  })
})
