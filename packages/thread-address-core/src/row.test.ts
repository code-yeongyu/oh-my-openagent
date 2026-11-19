import { describe, expect, test } from "bun:test"
import { mergeRows, rowAddress, rowKey, rowName } from "."

const row = (device: string, thread: string | undefined, key: string) => ({ device, durable_id: thread, session_id: key })

describe("#given a listing row #when its identity is read #then rowKey and rowAddress name it the way every tool accepts", () => {
  test("#given a row with a thread id #when keyed #then the key is the thread id and the address is <device>/<thread id>", () => {
    const listed = row("b7c41e09d2a64f1e", "0bb00001-0000-4000-8000-000000000001", "rk-b")
    expect(rowKey(listed)).toBe("0bb00001-0000-4000-8000-000000000001")
    expect(rowAddress(listed)).toBe("b7c41e09d2a64f1e/0bb00001-0000-4000-8000-000000000001")
  })

  test("#given a row that publishes no thread id #when keyed #then its key and address are <device>/<listing key>", () => {
    const listed = row("b7c41e09d2a64f1e", undefined, "rk-b")
    expect(rowKey(listed)).toBe("b7c41e09d2a64f1e/rk-b")
    expect(rowAddress(listed)).toBe("b7c41e09d2a64f1e/rk-b")
  })
})

describe("#given a row #when rowName names it #then only a real name is an address", () => {
  test.each([
    ["a real name", { name: "beta", first_message: "hello", folder: "/work/b" }, { name: "beta", unnamed: false }],
    ["no name, a first message", { name: "", first_message: "fix the login page", folder: "/work/b" }, { name: "fix the login page", unnamed: true }],
    ["no name and no message", { name: null, folder: "/work/b" }, { name: "b", unnamed: true }],
  ] as const)("%s", (_label, input, expected) => {
    expect(rowName(input)).toEqual(expected)
  })
})

describe("#given this device's rows and the account listing #when mergeRows merges them #then one thread is one row, on the device that holds it live", () => {
  const live = (device: string, key: string) => ({ key, device, live: true })
  const stale = (device: string, key: string) => ({ key, device, live: false })

  test("#given the listing's copy of this device's own session #when merged #then this device's own row is kept and the copy dropped", () => {
    expect(mergeRows([live("here", "t1")], [live("here", "t1"), live("b", "t2")], "here")).toEqual([
      live("here", "t1"),
      live("b", "t2"),
    ])
  })

  test("#given a stale copy here and the live holder on b #when merged #then b's live row is the row and notes the stale copy", () => {
    expect(mergeRows([stale("here", "t1")], [live("b", "t1")], "here")).toEqual([
      { ...live("b", "t1"), stale_copy_on: ["here"] },
    ])
  })

  test("#given no live holder #when merged #then this device's copy is the row", () => {
    expect(mergeRows([stale("here", "t1")], [stale("b", "t1")], "here")).toEqual([stale("here", "t1")])
  })

  test("#given distinct threads #when merged #then every row stays, in order", () => {
    expect(mergeRows([live("here", "t1"), stale("here", "t2")], [live("b", "t3")], "here")).toEqual([
      live("here", "t1"),
      stale("here", "t2"),
      live("b", "t3"),
    ])
  })
})
