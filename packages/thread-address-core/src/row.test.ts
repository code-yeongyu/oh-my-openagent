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

describe("#given this device's rows and the account listing #when mergeRows merges them #then one thread is one row", () => {
  const at = (device: string, key: string) => ({ key, device })

  test("#given the listing's copy of this device's own session #when merged #then this device's own row is kept and the copy dropped", () => {
    expect(mergeRows([at("here", "t1")], [at("here", "t1"), at("b", "t2")], "here")).toEqual([
      at("here", "t1"),
      at("b", "t2"),
    ])
  })

  test("#given a remote row whose id this device already lists #when merged #then it is not listed again", () => {
    expect(mergeRows([at("here", "t1")], [at("b", "t1")], "here")).toEqual([at("here", "t1")])
  })

  test("#given distinct threads #when merged #then every row stays, in order", () => {
    expect(mergeRows([at("here", "t1"), at("here", "t2")], [at("b", "t3"), at("c", "t4")], "here")).toEqual([
      at("here", "t1"),
      at("here", "t2"),
      at("b", "t3"),
      at("c", "t4"),
    ])
  })
})
