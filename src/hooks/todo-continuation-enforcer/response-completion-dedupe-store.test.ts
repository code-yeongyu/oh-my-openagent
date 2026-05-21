/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { createResponseCompletionDedupeStore } from "./response-completion-dedupe-store"

describe("createResponseCompletionDedupeStore", () => {
  test("#given a repeated response key #when it is marked twice #then the second mark is rejected", () => {
    // given
    const store = createResponseCompletionDedupeStore()

    // when
    const first = store.markHandled("ses-1", "id:msg-1")
    const second = store.markHandled("ses-1", "id:msg-1")

    // then
    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(store.size).toBe(1)
  })

  test("#given a cleared session #when the same key is marked again #then it is accepted", () => {
    // given
    const store = createResponseCompletionDedupeStore()
    store.markHandled("ses-1", "id:msg-1")

    // when
    store.clearSession("ses-1")
    const accepted = store.markHandled("ses-1", "id:msg-1")

    // then
    expect(accepted).toBe(true)
    expect(store.size).toBe(1)
  })

  test("#given stale sessions #when a new response is marked #then expired sessions are pruned", () => {
    // given
    let currentTime = 0
    const store = createResponseCompletionDedupeStore({
      ttlMs: 100,
      now: () => currentTime,
    })
    store.markHandled("old-1", "id:msg-1")
    store.markHandled("old-2", "id:msg-2")
    currentTime = 101

    // when
    store.markHandled("new-1", "id:msg-3")

    // then
    expect(store.size).toBe(1)
    expect(store.markHandled("old-1", "id:msg-1")).toBe(true)
  })

  test("#given more sessions than the cap #when responses are marked #then the oldest sessions are pruned", () => {
    // given
    let currentTime = 0
    const store = createResponseCompletionDedupeStore({
      maxSessions: 2,
      now: () => currentTime,
    })
    store.markHandled("old-1", "id:msg-1")
    currentTime = 1
    store.markHandled("old-2", "id:msg-2")
    currentTime = 2

    // when
    store.markHandled("new-1", "id:msg-3")

    // then
    expect(store.size).toBe(2)
    expect(store.markHandled("old-1", "id:msg-1")).toBe(true)
    expect(store.size).toBe(2)
  })
})
