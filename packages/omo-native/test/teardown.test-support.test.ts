import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  closeTrackedDatabases,
  rmSyncEbusyTolerant,
  TEARDOWN_FAILURE_PREFIX,
  teardownRoots,
  withDatabase,
  type RmSyncFn,
} from "./teardown.test-support"

function errno(code: string, message = `${code}: simulated`): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code })
}

describe("rmSyncEbusyTolerant", () => {
  test("#given rmSync throws EBUSY once then succeeds #when teardown runs #then the path is removed", () => {
    let calls = 0
    const rmSync: RmSyncFn = () => {
      calls += 1
      if (calls === 1) throw errno("EBUSY", "resource busy or locked")
    }

    rmSyncEbusyTolerant("/tmp/omo-native-teardown-ebusy-once", { recursive: true, force: true }, {
      rmSync,
      sleep: () => {},
    })

    expect(calls).toBe(2)
  })

  test("#given rmSync always throws ENOTEMPTY #when teardown runs #then the original error is rethrown immediately", () => {
    const error = errno("ENOTEMPTY", "directory not empty")
    let calls = 0
    const rmSync: RmSyncFn = () => {
      calls += 1
      throw error
    }

    let thrown: unknown
    try {
      rmSyncEbusyTolerant("/tmp/omo-native-teardown-enotempty", { recursive: true, force: true }, {
        rmSync,
        sleep: () => {
          throw new Error("sleep must not run for non-EBUSY")
        },
      })
    } catch (caught) {
      thrown = caught
    }

    expect(thrown).toBe(error)
    expect(calls).toBe(1)
  })

  test("#given rmSync always throws EBUSY #when the retry budget is exhausted #then the error message starts with teardown-failure:", () => {
    let calls = 0
    const rmSync: RmSyncFn = () => {
      calls += 1
      throw errno("EBUSY", "resource busy or locked")
    }

    let thrown: unknown
    try {
      rmSyncEbusyTolerant("/tmp/omo-native-teardown-ebusy-exhausted", { recursive: true, force: true }, {
        rmSync,
        sleep: () => {},
        ebusyAttempts: 4,
      })
    } catch (caught) {
      thrown = caught
    }

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message.startsWith(TEARDOWN_FAILURE_PREFIX)).toBe(true)
    expect((thrown as Error).message).toContain("after 4 attempts")
    expect(calls).toBe(4)
  })
})

describe("withDatabase", () => {
  test("#given the body throws #when it exits #then the handle is still closed exactly once", () => {
    let closes = 0
    const database = { close: () => { closes += 1 } }

    expect(() => withDatabase(database, () => { throw new Error("statement failed") })).toThrow("statement failed")

    expect(closes).toBe(1)
    closeTrackedDatabases()
    expect(closes).toBe(1)
  })

  test("#given a handle that fails to close #when teardown sweeps #then the failure does not escape", () => {
    const database = { close: () => { throw errno("ERR_INVALID_STATE", "database is not open") } }

    expect(() => withDatabase(database, () => "value")).not.toThrow()
  })
})

describe("teardownRoots", () => {
  test("#given populated roots #when teardown runs #then the list is drained and every tree is gone", () => {
    const roots = [0, 1].map(() => {
      const root = mkdtempSync(join(tmpdir(), "omo-native-teardown-"))
      writeFileSync(join(root, "file.txt"), "fixture")
      return root
    })

    const paths = [...roots]

    teardownRoots(roots)

    expect(roots).toHaveLength(0)
    for (const root of paths) expect(existsSync(root)).toBe(false)
  })
})
