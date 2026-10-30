import { expect, test } from "bun:test"
import { createRequestSnapshotStore } from "./request-snapshots"

const terminal = (id: string, error = false) => ({ id: `assistant-${id}`, parentID: id, finish: "stop", time: { completed: 1 }, ...(error ? { error: { name: "APIError" } } : {}) })

test.each([false, true])("completed history is bounded for success/error=%s", (error) => {
  const store = createRequestSnapshotStore<object>()
  for (let n = 0; n < 500; n++) {
    const id = `user-${n}`
    store.set("s", id, {})
    const event = store.capture("s", undefined, terminal(id, error))
    event.complete(terminal(id, error))
    event.release()
    expect(store.size("s")).toBe(0)
  }
})

test("event ownership protects an error through pending fallback, new user input, and queued dispatch", () => {
  const store = createRequestSnapshotStore<string>()
  store.set("s", "a", "old-profile")
  const event = store.capture("s", undefined, terminal("a", true))
  const recovery = store.capture("s", "runtime") // before fetching original user metadata
  event.complete(terminal("a", true))
  event.release()
  store.set("s", "b", "new-profile")
  expect(store.get("s", "a")).toBe("old-profile")
  recovery.bind("a")
  recovery.commit()
  store.resume("s", "b")
  expect(store.get("s", "a")).toBe("old-profile")
  expect(store.resume("s", "a")).toBe("old-profile")
  const final = store.capture("s", undefined, { ...terminal("a"), id: "retry-assistant" })
  final.complete(terminal("a"))
  final.release()
  expect(store.get("s", "a")).toBeUndefined()
  expect(store.get("s", "b")).toBe("new-profile")
})

test("ACK after retry re-entry cannot pin or terminate the newer generation", () => {
  const store = createRequestSnapshotStore<string>()
  store.set("s", "a", "old-profile")
  const error = store.capture("s", undefined, terminal("a", true))
  const recovery = store.capture("s", "runtime")
  recovery.bind("a")
  store.resume("s", "a")
  error.complete(terminal("a", true))
  error.release()
  recovery.commit()
  expect(store.get("s", "a")).toBe("old-profile")
  const final = store.capture("s", undefined, { ...terminal("a"), id: "recovered" })
  final.complete(terminal("a"))
  final.release()
  expect(store.size("s")).toBe(0)
})

test("duplicate old assistant completion after retry starts cannot complete the retry", () => {
  const store = createRequestSnapshotStore<string>()
  store.set("s", "a", "profile")
  const first = store.capture("s", undefined, { id: "old-assistant", parentID: "a" })
  first.release()
  store.resume("s", "a")
  const late = store.capture("s", undefined, { ...terminal("a", true), id: "old-assistant" })
  late.complete(terminal("a", true))
  late.release()
  expect(store.get("s", "a")).toBe("profile")
})

test("a rejected replacement cannot revoke an earlier accepted or ambiguous retry owner", () => {
  const store = createRequestSnapshotStore<string>()
  store.set("s", "a", "profile")
  const first = store.capture("s", "runtime")
  first.bind("a"); first.commit()
  const timeout = store.capture("s", "runtime")
  const error = store.capture("s", undefined, terminal("a", true))
  error.complete(terminal("a", true)); error.release()
  expect(store.get("s", "a")).toBe("profile")
  const next = store.capture("s", "runtime")
  next.bind("a"); next.release() // failed gate: no accepted retry owns the request
  expect(store.get("s", "a")).toBe("profile")
  timeout.release()
  expect(first.owns("a")).toBe(true)
  expect(store.get("s", "a")).toBe("profile")
  store.resume("s", "a")
  const final = store.capture("s")
  final.complete(terminal("a")); final.release()
  expect(store.size("s")).toBe(0)
})

test.each(["replace", "resume"])("late removal cannot delete a %s generation", (action) => {
  const store = createRequestSnapshotStore<string>()
  store.set("s", "a", "old")
  const removal = store.capture("s")
  if (action === "replace") { store.remove("s", "a"); store.set("s", "a", "new") }
  else store.resume("s", "a")
  removal.remove("a"); removal.release()
  expect(store.get("s", "a")).toBe(action === "replace" ? "new" : "old")
})

test("a first-seen old assistant completion cannot terminate a recreated request", () => {
  const store = createRequestSnapshotStore<string>()
  store.set("s", "a", "new")
  const info = { ...terminal("a", true), time: { created: 1, completed: 2 } }
  const late = store.capture("s", undefined, info)
  late.complete(info); late.release()
  expect(store.get("s", "a")).toBe("new")
})

test("late owners cannot delete or resurrect a removed/recreated request or session", () => {
  const store = createRequestSnapshotStore<string>()
  store.set("s", "a", "old")
  const late = store.capture("s", undefined, terminal("a"))
  store.clear("s")
  store.set("s", "a", "new")
  late.complete(terminal("a")); late.release()
  expect(store.get("s", "a")).toBe("new")
})

test("message removal releases an accepted pending owner and its strong snapshot references", () => {
  const store = createRequestSnapshotStore<string>()
  store.set("s", "a", "profile")
  const pending = store.capture("s", "runtime")
  pending.bind("a"); pending.commit()
  expect(pending.owns("a")).toBe(true)
  store.remove("s", "a")
  expect(pending.owns("a")).toBe(false)
  expect(store.size("s")).toBe(0)
  pending.release()
})

test("tool steps, incomplete output and another request do not release active snapshots", () => {
  const store = createRequestSnapshotStore<string>()
  store.set("s", "a", "profile")
  for (const info of [{ ...terminal("a"), finish: "tool-calls" }, { ...terminal("a"), time: {} }, terminal("other")]) {
    const event = store.capture("s")
    event.complete(info); event.release()
    expect(store.get("s", "a")).toBe("profile")
  }
  store.remove("s", "a")
  expect(store.size("s")).toBe(0)
})

test.each(["other", "error", "length", "content-filter"])("host terminal finish %s releases its snapshot", (finish) => {
  const store = createRequestSnapshotStore<string>()
  store.set("s", "a", "profile")
  const event = store.capture("s")
  event.complete({ ...terminal("a"), finish }); event.release()
  expect(store.size("s")).toBe(0)
})
