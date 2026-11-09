import { expect, test } from "bun:test"
import { windowsTreeKillArgs } from "./windows-process-tree.mjs"

const argsFor = (rows: string, selfPid = 900) =>
  windowsTreeKillArgs(100, () => ({ status: 0, stdout: rows }), selfPid)

test("#given recycled parent PIDs #when selecting a tree #then older unrelated processes are excluded at every edge", () => {
  const rows = [
    "104 101 220 child.exe",
    "102 100 50 unrelated.exe",
    "103 101 150 unrelated.exe",
    "101 100 210 node.exe",
    "100 1 200 bun.exe",
  ].join("\n")
  expect(argsFor(rows)).toEqual(["/F", "/PID", "100", "/PID", "101", "/PID", "104"])
})

test("#given missing creation times #when selecting descendants #then unknown edges are not traversed", () => {
  expect(argsFor("100 1 200 bun.exe\n101 100 0 child.exe")).toEqual(["/F", "/PID", "100"])
  expect(argsFor("100 1 0 bun.exe\n101 100 210 child.exe")).toEqual(["/F", "/PID", "100"])
})

test("#given protected images or own ancestors #when selecting the tree #then they are never killed", () => {
  expect(argsFor("100 1 200 bun.exe\n101 100 210 svchost.exe")).toEqual(["/F", "/PID", "100"])
  expect(argsFor("100 1 200 bun.exe\n101 100 210 node.exe\n900 101 220 test.exe")).toEqual([])
  expect(argsFor("100 1 200 svchost.exe")).toEqual([])
})

test("#given a missing root or malformed listing #when selecting a tree #then no unchecked descendants are killed", () => {
  expect(argsFor("101 1 210 child.exe")).toEqual([])
  expect(windowsTreeKillArgs(100, () => ({ status: 0, stdout: "bad output" }))).toEqual(["/F", "/PID", "100"])
})

test.each([
  { name: "live descendants after root exit", rows: "102 101 220 child.exe\n101 100 210 node.exe", rootStartedAt: 200n, expected: ["/F", "/PID", "101", "/PID", "102"] },
  { name: "missing spawn time", rows: "101 100 210 node.exe", rootStartedAt: undefined, expected: [] },
  { name: "unknown spawn time", rows: "101 100 210 node.exe", rootStartedAt: 0n, expected: [] },
  { name: "child older than the spawned root", rows: "101 100 199 unrelated.exe", rootStartedAt: 200n, expected: [] },
  { name: "child at the spawn boundary", rows: "101 100 200 child.exe", rootStartedAt: 200n, expected: ["/F", "/PID", "101"] },
  { name: "unknown child creation time", rows: "101 100 0 child.exe", rootStartedAt: 200n, expected: [] },
  { name: "recycled intermediate pid", rows: "101 100 210 node.exe\n102 101 205 unrelated.exe", rootStartedAt: 200n, expected: ["/F", "/PID", "101"] },
  { name: "live root with checked descendants", rows: "100 1 200 bun.exe\n101 100 210 child.exe", rootStartedAt: undefined, expected: ["/F", "/PID", "100", "/PID", "101"] },
  { name: "own ancestor below a missing root", rows: "101 100 210 node.exe\n900 101 220 test.exe", rootStartedAt: 200n, expected: [] },
  { name: "protected image below a missing root", rows: "101 100 210 SVCHOST.EXE", rootStartedAt: 200n, expected: [] },
  { name: "own live ancestor", rows: "100 1 200 bun.exe\n900 100 220 test.exe", rootStartedAt: 200n, expected: [] },
  { name: "protected live root", rows: "100 1 200 services.exe", rootStartedAt: 200n, expected: [] },
])("#given $name #when selecting a tree #then only proven descendants are selected", ({ rows, rootStartedAt, expected }) => {
  expect(windowsTreeKillArgs(100, () => ({ status: 0, stdout: rows }), 900, rootStartedAt)).toEqual([...expected])
})

test.each([
  { name: "failed", result: { status: 1 } },
  { name: "timed out", result: { status: null, error: Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }) } },
  { name: "unavailable", result: { status: null, error: new Error("unavailable") } },
])("#given a $name process listing #when killing an owned root #then taskkill walks its live tree", ({ result }) => {
  expect(windowsTreeKillArgs(100, () => result, 900)).toEqual(["/F", "/T", "/PID", "100"])
})

test("#given an invalid or own root #when selecting a tree #then no process probe executes", () => {
  for (const pid of [0, -1, Number.NaN, process.pid]) {
    expect(windowsTreeKillArgs(pid, () => { throw new Error("unexpected probe") })).toEqual([])
  }
})
