import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { parseSync } from "oxc-parser"
import { formatAddress, parseAddress } from "."

describe("#given an address text #when parseAddress reads it #then it names self, a bare address or a device and a thread", () => {
  test.each([
    ["self", "self", { kind: "self" }],
    ["a thread id", "0aa00001-0000-4000-8000-000000000001", { kind: "bare", text: "0aa00001-0000-4000-8000-000000000001" }],
    ["a name with spaces, trimmed", "  my thread  ", { kind: "bare", text: "my thread" }],
    ["device and thread", "studio/beta", { kind: "device", device: "studio", thread: "beta", text: "studio/beta" }],
    ["here and a thread", "here/rpc-3", { kind: "device", device: "here", thread: "rpc-3", text: "here/rpc-3" }],
    ["two slashes", "a/b/c", { kind: "bare", text: "a/b/c" }],
    ["a leading slash", "/b", { kind: "bare", text: "/b" }],
    ["a trailing slash", "a/", { kind: "bare", text: "a/" }],
    ["a relative path", "./x", { kind: "bare", text: "./x" }],
    ["a home path", "~/x", { kind: "bare", text: "~/x" }],
    ["a drive letter", "C:/x", { kind: "bare", text: "C:/x" }],
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

// Package contract: remote/seams.ts (the published omo-ai/remote types) imports parse.ts, and remote/types-closure.test.ts
// allows it only as a leaf. Any import here would ship as a private declaration consumers cannot compile.
describe("#given parse.ts #when its imports are read #then it imports nothing", () => {
  test("#given the source #when parsed #then it has no import, re-export or dynamic import", () => {
    const path = new URL("./parse.ts", import.meta.url).pathname
    const program = parseSync(path, readFileSync(path, "utf8")).program
    const sources = JSON.stringify(program.body).match(/"type":"(ImportDeclaration|ExportAllDeclaration|ImportExpression)"/g)
    const reExports = program.body.filter((node) => node.type === "ExportNamedDeclaration" && node.source !== null)
    expect(sources ?? []).toEqual([])
    expect(reExports).toEqual([])
  })
})
