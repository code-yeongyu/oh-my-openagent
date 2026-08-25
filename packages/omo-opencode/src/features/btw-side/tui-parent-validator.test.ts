import { describe, expect, it, mock } from "bun:test"

import { createBtwParentValidator } from "./tui-parent-validator"

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe("createBtwParentValidator", () => {
  it("#given a persisted side #when its parent is remote or deleted during lookup #then only an existing parent validates", async () => {
    // given
    const remoteResults: Array<"retry" | "exists"> = [
      "retry",
      "exists",
    ]
    const fetchStatus = mock(async () => remoteResults.shift() ?? "missing")
    const validator = createBtwParentValidator({
      fetchStatus,
    })

    // then
    expect(await validator.exists("ses_parent")).toBe(true)
    expect(fetchStatus).toHaveBeenCalledTimes(2)

    // given
    const missingValidator = createBtwParentValidator({
      fetchStatus: async () => "missing",
    })

    // then
    expect(await missingValidator.exists("ses_missing")).toBe(false)

    // given
    const deferred = createDeferred<"exists">()
    const racingValidator = createBtwParentValidator({
      fetchStatus: () => deferred.promise,
    })
    const validation = racingValidator.exists("ses_deleted_parent")

    // when
    racingValidator.markDeleted("ses_deleted_parent")
    deferred.resolve("exists")

    // then
    expect(await validation).toBe(false)
  })

  it("#given stale local parent state #when the remote parent was deleted #then adoption requires remote confirmation", async () => {
    // given
    const remoteResults: Array<"exists" | "missing"> = ["exists", "missing"]
    const fetchStatus = mock(async () => remoteResults.shift() ?? "missing")
    const validator = createBtwParentValidator({
      fetchStatus,
    })

    // when
    const initiallyValid = await validator.exists("ses_parent")
    const validAfterRemoteDeletion = await validator.exists("ses_parent")

    // then
    expect(initiallyValid).toBe(true)
    expect(validAfterRemoteDeletion).toBe(false)
    expect(fetchStatus).toHaveBeenCalledTimes(2)
  })
})
