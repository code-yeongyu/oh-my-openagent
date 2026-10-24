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

test("#given a missing root or unavailable listing #when selecting a tree #then no unchecked descendants are killed", () => {
  expect(argsFor("101 1 210 child.exe")).toEqual([])
  for (const result of [{ status: 1 }, { status: 0, stdout: "bad output" }, { status: null, error: new Error("unavailable") }]) {
    expect(windowsTreeKillArgs(100, () => result)).toEqual(["/F", "/PID", "100"])
  }
})

test("#given an invalid or own root #when selecting a tree #then no process probe executes", () => {
  for (const pid of [0, -1, Number.NaN, process.pid]) {
    expect(windowsTreeKillArgs(pid, () => { throw new Error("unexpected probe") })).toEqual([])
  }
})
