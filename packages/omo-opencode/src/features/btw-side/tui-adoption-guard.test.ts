import { describe, expect, it } from "bun:test"

import { createBtwAdoptionGuard } from "./tui-adoption-guard"

describe("createBtwAdoptionGuard", () => {
  it("#given a delayed metadata lookup #when route, deletion, or disposal changes #then stale adoption is rejected", () => {
    // given
    let currentSessionID: string | undefined = "ses_side"
    const guard = createBtwAdoptionGuard(() => currentSessionID)

    // then
    expect(guard.canApply("ses_side")).toBe(true)

    // when
    currentSessionID = "ses_other"

    // then
    expect(guard.canApply("ses_side")).toBe(false)

    // when
    currentSessionID = "ses_side"
    guard.markDeleted("ses_side")

    // then
    expect(guard.canApply("ses_side")).toBe(false)

    // when
    const disposedGuard = createBtwAdoptionGuard(() => "ses_side")
    disposedGuard.dispose()

    // then
    expect(disposedGuard.canApply("ses_side")).toBe(false)

    // when
    const deletedParentGuard = createBtwAdoptionGuard(() => "ses_side")
    deletedParentGuard.markDeleted("ses_parent")

    // then
    expect(
      deletedParentGuard.canApply("ses_side", "ses_parent"),
    ).toBe(false)
  })
})
