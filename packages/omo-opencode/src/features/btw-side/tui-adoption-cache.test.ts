import { describe, expect, it } from "bun:test"

import { createBtwSideMetadata } from "./metadata"
import { createBtwAdoptionCache } from "./tui-adoption-cache"

describe("createBtwAdoptionCache", () => {
  it("#given persisted BTW metadata #when the parent is deleted #then side identity remains until side deletion", () => {
    // given
    const cache = createBtwAdoptionCache()
    const metadata = createBtwSideMetadata({
      parentSessionID: "ses_parent",
      boundaryMessageID: "msg_parent",
    })
    cache.write("ses_side", metadata)

    // then
    expect(cache.read("ses_side")).toEqual({
      hydrated: true,
      metadata,
    })
    expect(cache.read("ses_side")).toEqual({
      hydrated: true,
      metadata,
    })

    // when
    cache.removeForDeletion("ses_other")

    // then
    expect(cache.read("ses_side").hydrated).toBe(true)

    // when
    cache.removeForDeletion("ses_parent")

    // then
    expect(cache.read("ses_side")).toEqual({
      hydrated: true,
      metadata,
    })

    // when
    cache.removeForDeletion("ses_side")

    // then
    expect(cache.read("ses_side")).toEqual({ hydrated: false })
  })
})
