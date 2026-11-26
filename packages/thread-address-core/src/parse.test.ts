import { describe, expect, test } from "bun:test"
import { formatAddress, idShaped, parseAddress } from "."

describe("#given an address text #when parseAddress reads it #then it names self, a bare address or a device and a thread", () => {
  test.each([
    ["self", "self", { kind: "self" }],
    [
      "a thread id",
      "0aa00001-0000-4000-8000-000000000001",
      { kind: "bare", text: "0aa00001-0000-4000-8000-000000000001" },
    ],
    ["a name with spaces, trimmed", "  my thread  ", { kind: "bare", text: "my thread" }],
    ["device and thread", "studio/beta", { kind: "device", device: "studio", thread: "beta", text: "studio/beta" }],
    ["here and a thread", "here/rpc-3", { kind: "device", device: "here", thread: "rpc-3", text: "here/rpc-3" }],
    ["two slashes", "a/b/c", { kind: "bare", text: "a/b/c" }],
    ["a leading slash", "/b", { kind: "bare", text: "/b" }],
    ["a trailing slash", "a/", { kind: "bare", text: "a/" }],
    ["a relative path", "./x", { kind: "bare", text: "./x" }],
    ["a home path", "~/x", { kind: "bare", text: "~/x" }],
    ["a drive letter", "C:/x", { kind: "bare", text: "C:/x" }],
    ["mixed drive path", "C:\\a/b", { kind: "bare", text: "C:\\a/b" }],
    ["mixed UNC path", "\\\\srv\\share/x", { kind: "bare", text: "\\\\srv\\share/x" }],
    ["mixed relative path", "dir\\sub/x", { kind: "bare", text: "dir\\sub/x" }],
    ["drive-relative path", "C:dir/x", { kind: "bare", text: "C:dir/x" }],
    ["a session file", "dir/x.jsonl", { kind: "bare", text: "dir/x.jsonl" }],
  ] as const)("%s", (_label, text, expected) => {
    expect(parseAddress(text)).toEqual(expected)
  })

  test("#given a device id and a thread id #when formatted #then parseAddress reads the same two parts back", () => {
    expect(parseAddress(formatAddress("b7c41e09d2a64f1e", "0bb00001-0000-4000-8000-000000000001"))).toEqual({
      kind: "device",
      device: "b7c41e09d2a64f1e",
      thread: "0bb00001-0000-4000-8000-000000000001",
      text: "b7c41e09d2a64f1e/0bb00001-0000-4000-8000-000000000001",
    })
  })
})

describe("#given a thread part #when idShaped reads it #then only a thread id or a session id is id-shaped", () => {
  test.each([
    ["a thread id", "0bb00001-0000-4000-8000-000000000001", true],
    ["a 22-character listing key", "AbCdEfGhIjKlMnOpQrStUv", true],
    ["a routing id", "rpc-7", true],
    ["a name", "beta old", false],
    ["a 16+ character hyphenated name", "release-planner-2", false],
    ["a 16-character name of key characters", "nothing-named-so", false],
    ["a short word", "beta", false],
  ] as const)("%s", (_label, text, expected) => {
    expect(idShaped(text)).toBe(expected)
  })
})
