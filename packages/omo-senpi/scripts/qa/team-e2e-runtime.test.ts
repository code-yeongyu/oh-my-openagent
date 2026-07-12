import { describe, expect, it } from "bun:test"
import { isAbsolute, join, resolve } from "node:path"

import { createOutDir } from "./team-e2e.mjs"
import * as runtime from "./team-e2e-runtime.mjs"

describe("team e2e output paths", () => {
  it("#given a configured relative output path #when the capture directory is created #then it is absolute", () => {
    // given
    const configured = join(".omo", "evidence", "relative-team-e2e")

    // when
    const output = createOutDir(configured)

    // then
    expect(output).toEqual({ outDir: resolve(configured), cleanup: false })
    expect(isAbsolute(output.outDir)).toBe(true)
  })
})

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
