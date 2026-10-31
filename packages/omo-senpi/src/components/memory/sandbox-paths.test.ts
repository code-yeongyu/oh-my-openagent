import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { AUTOMOUNT_TRIGGER_CASES, withAutomountTrap } from "../../automount-trap.test-support"
import { canonicalAbsentPath, canonicalPath } from "./sandbox-paths"

describe("sandbox grants never resolve a macOS automount trigger (#11545)", () => {
  test.each([...AUTOMOUNT_TRIGGER_CASES])("#given a grant entry %s on darwin #when canonicalized #then it is kept as written without resolving the trigger", async (path) => {
    const touched = await withAutomountTrap(() => {
      expect(canonicalPath(path)).toBe(path)
      expect(canonicalAbsentPath(`${path}/child`)).toBe(join(path, "child"))
    })
    expect(touched).toEqual([])
  })
})
