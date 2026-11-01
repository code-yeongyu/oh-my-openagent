import { describe, expect, test } from "bun:test"
import { lstatSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { removeTree, removeTreeSync } from "./remove-tree"

function codeError(code: string): Error {
  return Object.assign(new Error(code), { code })
}

describe("removeTree", () => {
  test("#given a transient EBUSY twice #when removing #then it retries and succeeds", async () => {
    // given
    let calls = 0
    const remove = async () => {
      calls++
      if (calls <= 2) throw codeError("EBUSY")
    }

    // when
    await removeTree("/unused", { maxRetries: 5, retryDelay: 1 }, remove)

    // then
    expect(calls).toBe(3)
  })

  test("#given a transient error that never clears #when retries run out #then the original error is thrown", async () => {
    // given
    const error = codeError("EPERM")
    let calls = 0
    const remove = async () => {
      calls++
      throw error
    }

    // when
    const failure = await removeTree("/unused", { maxRetries: 2, retryDelay: 1 }, remove).catch((caught: unknown) => caught)

    // then
    expect(failure).toBe(error)
    expect(calls).toBe(3)
  })

  test("#given a non-transient error #when removing #then it is thrown without retrying", async () => {
    // given
    const error = codeError("EACCES")
    let calls = 0
    const remove = async () => {
      calls++
      throw error
    }

    // when
    const failure = await removeTree("/unused", { maxRetries: 5, retryDelay: 1 }, remove).catch((caught: unknown) => caught)

    // then
    expect(failure).toBe(error)
    expect(calls).toBe(1)
  })
})

describe("removeTreeSync", () => {
  test("#given a vanishing child #when recursively removing #then the fixture parent is gone", () => {
    const root = mkdtempSync(join(tmpdir(), "omo-root-sweep-"))
    mkdirSync(join(root, "omo-test-run-a.removing"))
    try {
      removeTreeSync(root, { maxRetries: 2, retryDelay: 0 })
      expect(lstatSync(root, { throwIfNoEntry: false })).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  for (const stays of [false, true]) {
    test(`#given a remover silently leaves a path (permanent: ${stays}) #when removing #then it retries or throws at the bound`, () => {
      const root = mkdtempSync(join(tmpdir(), "omo-remove-tree-"))
      let calls = 0
      const remove = () => {
        calls++
        if (!stays && calls === 2) rmSync(root, { recursive: true, force: true })
      }
      try {
        const run = () => removeTreeSync(root, { maxRetries: 2, retryDelay: 0 }, remove)
        if (stays) {
          expect(run).toThrow(expect.objectContaining({ code: "ENOTEMPTY", path: root }))
          expect(calls).toBe(3)
        } else {
          run()
          expect(calls).toBe(2)
          expect(lstatSync(root, { throwIfNoEntry: false })).toBeUndefined()
        }
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })
  }

  test("#given a transient EBUSY once #when removing #then it retries and succeeds", () => {
    // given
    let calls = 0
    const remove = () => {
      calls++
      if (calls === 1) throw codeError("EBUSY")
    }

    // when
    removeTreeSync("/unused", { maxRetries: 5, retryDelay: 1 }, remove)

    // then
    expect(calls).toBe(2)
  })

  test("#given a transient error that never clears #when retries run out #then the original error is thrown", () => {
    // given
    const error = codeError("ENOTEMPTY")
    const remove = () => {
      throw error
    }

    // when / then
    expect(() => removeTreeSync("/unused", { maxRetries: 1, retryDelay: 1 }, remove)).toThrow(error)
  })
})
