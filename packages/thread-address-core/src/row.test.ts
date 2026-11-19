import { describe, expect, test } from "bun:test"
import { listingKey, mergeRows, rowAddress, rowKey, rowName, sameSession } from "."

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

describe("#given two records of a session #when sameSession compares them #then devices must match, then ids when both have one, else listing keys", () => {
  test.each([
    ["both ids, equal", { device: "b", thread: "t1", key: "k1" }, { device: "b", thread: "t1", key: "k2" }, true],
    ["both ids, different, same key", { device: "b", thread: "t1", key: "k1" }, { device: "b", thread: "t2", key: "k1" }, false],
    ["one id, equal keys", { device: "b", thread: "t1", key: "k1" }, { device: "b", key: "k1" }, true],
    ["one id, different keys", { device: "b", thread: "t1", key: "k1" }, { device: "b", key: "k2" }, false],
    ["no ids, equal keys", { device: "b", key: "k1" }, { device: "b", key: "k1" }, true],
    ["no ids, no keys", { device: "b" }, { device: "b" }, false],
    ["different devices, same id", { device: "b", thread: "t1" }, { device: "c", thread: "t1" }, false],
  ] as const)("%s", (_label, a, b, expected) => {
    expect(sameSession(a, b)).toBe(expected)
    expect(sameSession(b, a)).toBe(expected)
  })

  test("#given a device and a listing key #when keyed #then the key is unique across devices", () => {
    expect(listingKey("b", "rk-1")).not.toBe(listingKey("c", "rk-1"))
    expect(listingKey("b", "rk-1")).toBe("b/rk-1")
  })
})
