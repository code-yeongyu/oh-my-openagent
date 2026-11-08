import { describe, expect, test } from "bun:test"

import { ChildParentLink, type ParentPermissionMode } from "./parent-link"

// #6189 F2e follow-failure notices (review LOWs of #12839): one notice per task, replaced by a newer failure,
// released once a later push lands, released when the link closes, and never added by a push that fails after close.

function parentMode(initial: string): ParentPermissionMode & { change(preset: string): void } {
  let current = initial
  const listeners = new Set<(preset: string) => void>()
  return {
    current: () => current,
    onChange: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    change: (preset) => { current = preset; for (const listener of listeners) listener(preset) },
  }
}

// The session's notice list: add returns the release, as host notices do.
function notices() {
  const active = new Map<number, string>()
  let next = 0
  let waiters: Array<() => void> = []
  const changed = () => { for (const wake of waiters.splice(0)) wake() }
  return {
    active: () => [...active.values()],
    add: (_message: string, token: string) => {
      const id = next++
      active.set(id, token)
      changed()
      return () => { active.delete(id); changed() }
    },
    until: async (predicate: () => boolean) => {
      while (!predicate()) await new Promise<void>((resolve) => waiters.push(resolve))
    },
  }
}

function pushes() {
  const calls: Array<PromiseWithResolvers<void>> = []
  let waiter: (() => void) | undefined
  return {
    push: (_preset: string) => { const call = Promise.withResolvers<void>(); calls.push(call); waiter?.(); return call.promise },
    nth: async (index: number) => {
      while (calls.length <= index) await new Promise<void>((resolve) => { waiter = resolve })
      return calls[index] as PromiseWithResolvers<void>
    },
  }
}

describe("ChildParentLink follow notices", () => {
  test("#given a failed follow #when a second one fails and then a push lands #then one notice stands, replaced, then released", async () => {
    // given
    const mode = parentMode("full-access")
    const list = notices()
    const pushed = pushes()
    const link = new ChildParentLink("st_n1", undefined, mode, list.add)
    link.named({})
    link.follow(pushed.push)

    // when / then
    mode.change("ask")
    ;(await pushed.nth(0)).reject(new Error("refused"))
    await list.until(() => list.active().length === 1)
    mode.change("read-only")
    ;(await pushed.nth(1)).reject(new Error("refused again"))
    await list.until(() => list.active().length === 1 && list.active()[0] === "follow:st_n1")
    expect(list.active()).toEqual(["follow:st_n1"])
    mode.change("ask")
    ;(await pushed.nth(2)).resolve()
    await list.until(() => list.active().length === 0)
    expect(list.active()).toEqual([])
  })

  test("#given a standing follow notice #when the link closes #then the notice is released", async () => {
    // given
    const mode = parentMode("full-access")
    const list = notices()
    const pushed = pushes()
    const link = new ChildParentLink("st_n2", undefined, mode, list.add)
    link.named({})
    link.follow(pushed.push)
    mode.change("ask")
    ;(await pushed.nth(0)).reject(new Error("refused"))
    await list.until(() => list.active().length === 1)

    // when
    link.close()

    // then
    expect(list.active()).toEqual([])
  })

  test("#given a push in flight #when the link closes and the push then fails #then no notice is added", async () => {
    // given
    const mode = parentMode("full-access")
    const list = notices()
    const pushed = pushes()
    const link = new ChildParentLink("st_n3", undefined, mode, list.add)
    link.named({})
    link.follow(pushed.push)
    mode.change("ask")
    const inFlight = await pushed.nth(0)

    // when
    link.close()
    inFlight.reject(new Error("the connection closed"))
    await inFlight.promise.catch(() => undefined)
    await Promise.resolve()

    // then
    expect(list.active()).toEqual([])
  })
})
