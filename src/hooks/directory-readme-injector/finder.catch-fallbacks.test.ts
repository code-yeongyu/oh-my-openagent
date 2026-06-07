import { afterAll, describe, expect, it, mock } from "bun:test"

afterAll(() => {
  mock.restore()
})

describe("directory README finder catch fallbacks", () => {
  it("skips missing README files when access rejects with an Error", async () => {
    // given
    mock.module("node:fs/promises", () => ({
      access: mock(async () => {
        throw new Error("missing")
      }),
    }))
    const { findReadmeMdUp } = await import(`./finder?error=${crypto.randomUUID()}`)

    // when
    const found = await findReadmeMdUp({ startDir: "/workspace/src", rootDir: "/workspace" })

    // then
    expect(found).toEqual([])
  })

  it("skips missing README files when access rejects with a non-Error", async () => {
    // given
    const nonError = Symbol("missing")
    mock.module("node:fs/promises", () => ({
      access: mock(async () => {
        throw nonError
      }),
    }))
    const { findReadmeMdUp } = await import(`./finder?non-error=${crypto.randomUUID()}`)

    // when
    const found = await findReadmeMdUp({ startDir: "/workspace/src", rootDir: "/workspace" })

    // then
    expect(found).toEqual([])
  })
})
