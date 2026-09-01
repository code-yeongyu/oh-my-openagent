import { describe, expect, test } from "bun:test"

import {
  rmEfaultTolerant,
  rmSyncEfaultTolerant,
  TEARDOWN_FAILURE_PREFIX,
  type RmAsyncFn,
  type RmSyncFn,
} from "./teardown.test-support"

function errno(code: string, message = `${code}: simulated`): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code })
}

describe("rmSyncEfaultTolerant", () => {
  test("#given rmSync throws EFAULT once then succeeds #when teardown runs #then the path is removed", () => {
    let calls = 0
    const rmSync: RmSyncFn = () => {
      calls += 1
      if (calls === 1) throw errno("EFAULT", "bad address in system call argument")
    }

    rmSyncEfaultTolerant("/tmp/omo-teardown-efault-once", { recursive: true, force: true }, {
      rmSync,
      sleep: () => {},
    })

    expect(calls).toBe(2)
  })

  test("#given rmSync always throws ENOENT #when teardown runs #then the original error is rethrown immediately", () => {
    const error = errno("ENOENT", "no such file or directory")
    let calls = 0
    const rmSync: RmSyncFn = () => {
      calls += 1
      throw error
    }

    let thrown: unknown
    try {
      rmSyncEfaultTolerant("/tmp/omo-teardown-enoent", { recursive: true, force: true }, {
        rmSync,
        sleep: () => {
          throw new Error("sleep must not run for non-EFAULT")
        },
      })
    } catch (caught) {
      thrown = caught
    }

    expect(thrown).toBe(error)
    expect(calls).toBe(1)
  })

  test("#given rmSync always throws EFAULT #when the retry budget is exhausted #then the error message starts with teardown-failure:", () => {
    let calls = 0
    const rmSync: RmSyncFn = () => {
      calls += 1
      throw errno("EFAULT", "bad address in system call argument")
    }

    let thrown: unknown
    try {
      rmSyncEfaultTolerant("/tmp/omo-teardown-efault-exhausted", { recursive: true, force: true }, {
        rmSync,
        sleep: () => {},
        efaultAttempts: 3,
      })
    } catch (caught) {
      thrown = caught
    }

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message.startsWith(TEARDOWN_FAILURE_PREFIX)).toBe(true)
    expect(calls).toBe(3)
  })
})

describe("rmEfaultTolerant", () => {
  test("#given rm throws EFAULT once then succeeds #when teardown runs #then the path is removed", async () => {
    let calls = 0
    const rm: RmAsyncFn = async () => {
      calls += 1
      if (calls === 1) throw errno("EFAULT", "bad address in system call argument")
    }

    await rmEfaultTolerant("/tmp/omo-teardown-efault-once-async", { recursive: true, force: true }, {
      rm,
      sleep: async () => {},
    })

    expect(calls).toBe(2)
  })

  test("#given rm always throws ENOENT #when teardown runs #then the original error is rethrown immediately", async () => {
    const error = errno("ENOENT", "no such file or directory")
    let calls = 0
    const rm: RmAsyncFn = async () => {
      calls += 1
      throw error
    }

    let thrown: unknown
    try {
      await rmEfaultTolerant("/tmp/omo-teardown-enoent-async", { recursive: true, force: true }, {
        rm,
        sleep: async () => {
          throw new Error("sleep must not run for non-EFAULT")
        },
      })
    } catch (caught) {
      thrown = caught
    }

    expect(thrown).toBe(error)
    expect(calls).toBe(1)
  })

  test("#given rm always throws EFAULT #when the retry budget is exhausted #then the error message starts with teardown-failure:", async () => {
    let calls = 0
    const rm: RmAsyncFn = async () => {
      calls += 1
      throw errno("EFAULT", "bad address in system call argument")
    }

    let thrown: unknown
    try {
      await rmEfaultTolerant("/tmp/omo-teardown-efault-exhausted-async", { recursive: true, force: true }, {
        rm,
        sleep: async () => {},
        efaultAttempts: 3,
      })
    } catch (caught) {
      thrown = caught
    }

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message.startsWith(TEARDOWN_FAILURE_PREFIX)).toBe(true)
    expect(calls).toBe(3)
  })
})
