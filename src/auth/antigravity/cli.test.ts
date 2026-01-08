import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"

const CANCEL = Symbol("cancel")

type ConfirmFn = (options: unknown) => Promise<boolean | typeof CANCEL>
type SelectFn = (options: unknown) => Promise<"free" | "paid" | typeof CANCEL>

const confirmMock = mock<ConfirmFn>(async () => false)
const selectMock = mock<SelectFn>(async () => "free")
const cancelMock = mock<(message?: string) => void>(() => {})

mock.module("@clack/prompts", () => {
  return {
    confirm: confirmMock,
    select: selectMock,
    isCancel: (value: unknown) => value === CANCEL,
    cancel: cancelMock,
  }
})

function setIsTty(isTty: boolean): () => void {
  const original = Object.getOwnPropertyDescriptor(process.stdout, "isTTY")

  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: isTty,
  })

  return () => {
    if (original) {
      Object.defineProperty(process.stdout, "isTTY", original)
    } else {
      // Best-effort restore: remove overridden property
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete (process.stdout as unknown as { isTTY?: unknown }).isTTY
    }
  }
}

describe("src/auth/antigravity/cli", () => {
  let restoreIsTty: (() => void) | null = null

  beforeEach(() => {
    confirmMock.mockReset()
    selectMock.mockReset()
    cancelMock.mockReset()
    restoreIsTty?.()
    restoreIsTty = null
  })

  afterEach(() => {
    restoreIsTty?.()
    restoreIsTty = null
  })

  it("promptAddAnotherAccount returns confirm result in TTY", async () => {
    // #given
    restoreIsTty = setIsTty(true)
    confirmMock.mockResolvedValueOnce(true)

    const { promptAddAnotherAccount } = await import("./cli")

    // #when
    const result = await promptAddAnotherAccount(2)

    // #then
    expect(result).toBe(true)
    expect(confirmMock).toHaveBeenCalledTimes(1)
  })

  it("promptAddAnotherAccount returns false in TTY when confirm is false", async () => {
    // #given
    restoreIsTty = setIsTty(true)
    confirmMock.mockResolvedValueOnce(false)

    const { promptAddAnotherAccount } = await import("./cli")

    // #when
    const result = await promptAddAnotherAccount(2)

    // #then
    expect(result).toBe(false)
    expect(confirmMock).toHaveBeenCalledTimes(1)
  })

  it("promptAddAnotherAccount returns false in non-TTY", async () => {
    // #given
    restoreIsTty = setIsTty(false)

    const { promptAddAnotherAccount } = await import("./cli")

    // #when
    const result = await promptAddAnotherAccount(3)

    // #then
    expect(result).toBe(false)
    expect(confirmMock).toHaveBeenCalledTimes(0)
  })

  it("promptAddAnotherAccount handles cancel", async () => {
    // #given
    restoreIsTty = setIsTty(true)
    confirmMock.mockResolvedValueOnce(CANCEL)

    const { promptAddAnotherAccount } = await import("./cli")

    // #when
    const result = await promptAddAnotherAccount(1)

    // #then
    expect(result).toBe(false)
  })

  it("promptAccountTier returns selected tier in TTY", async () => {
    // #given
    restoreIsTty = setIsTty(true)
    selectMock.mockResolvedValueOnce("paid")

    const { promptAccountTier } = await import("./cli")

    // #when
    const result = await promptAccountTier()

    // #then
    expect(result).toBe("paid")
    expect(selectMock).toHaveBeenCalledTimes(1)
  })

  it("promptAccountTier returns free in non-TTY", async () => {
    // #given
    restoreIsTty = setIsTty(false)

    const { promptAccountTier } = await import("./cli")

    // #when
    const result = await promptAccountTier()

    // #then
    expect(result).toBe("free")
    expect(selectMock).toHaveBeenCalledTimes(0)
  })

  it("promptAccountTier handles cancel", async () => {
    // #given
    restoreIsTty = setIsTty(true)
    selectMock.mockResolvedValueOnce(CANCEL)

    const { promptAccountTier } = await import("./cli")

    // #when
    const result = await promptAccountTier()

    // #then
    expect(result).toBe("free")
  })
})
