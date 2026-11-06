import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"
import { resolve } from "node:path"

const TABLE_MODULE = pathToFileURL(resolve(import.meta.dir, "../bin/lib/private-fd-table.js")).href

type Inspection = {
  table: Record<string, unknown>
  platform?: string
  pipes?: readonly number[]
  sockets?: readonly number[]
  ipc?: number | "unknown" | null
  shell?: boolean
  spawn?: "success" | "throw"
  captureStderr?: boolean
  capture?: boolean
  windowsNodeStats?: boolean
}

// Subprocess-local filesystem doubles exercise the descriptor contract on every OS without
// replacing process-wide builtins in the shared test runner.
function inspect(input: Inspection) {
  const node = Bun.which("node")
  if (node === null) throw new Error("private-fd contract tests require Node")
  const result = spawnSync(node, ["--input-type=module", "-e", `
import fs from "node:fs"
import childProcess from "node:child_process"
import { EventEmitter } from "node:events"
import { syncBuiltinESMExports } from "node:module"
const input = ${JSON.stringify(input)}
const closed = []
fs.fstatSync = fd => ({
  mode: (input.pipes ?? [5, 6]).includes(fd) ? 0o010600 : (input.sockets ?? []).includes(fd) ? 0o140600 : 0o100600,
  isSocket: () => (input.sockets ?? []).includes(fd),
  isFIFO: () => !input.windowsNodeStats && (input.pipes ?? [5, 6]).includes(fd),
})
fs.closeSync = fd => { closed.push(fd) }
let spawned
childProcess.spawn = (_command, _args, options) => {
  spawned = options
  if (input.spawn === "throw") throw new Error("spawn refused")
  const child = new EventEmitter()
  child.stderr = Object.assign(new EventEmitter(), { readableEnded: true })
  queueMicrotask(() => child.emit("exit", 0, null))
  return child
}
syncBuiltinESMExports()
Object.defineProperty(process, "channel", {
  value: input.ipc === "unknown" ? {} : input.ipc == null ? undefined : { fd: input.ipc },
})
const { inspectPrivateFdTable, privateFdHandoffFor } = await import(${JSON.stringify(TABLE_MODULE)})
closed.length = 0
const table = JSON.stringify(input.table)
const platform = input.platform ?? "win32"
const inspected = inspectPrivateFdTable(table, platform)
let handoff
let helperTable
if (input.capture) {
  process.env.SENPI_PRIVATE_FDS = table
  Object.defineProperty(process, "platform", { value: platform })
  const { privateFdHandoff } = await import(${JSON.stringify(new URL("./private-fds.js", TABLE_MODULE).href)})
  handoff = privateFdHandoff({ KEEP: "yes" })
  helperTable = process.env.SENPI_PRIVATE_FDS ?? null
  closed.length = 0
} else handoff = privateFdHandoffFor({ KEEP: "yes" }, table, platform, { shell: input.shell })
let failure
if (input.spawn) {
  const { runChild } = await import(${JSON.stringify(new URL("./child-process.js", TABLE_MODULE).href)})
  closed.length = 0
  try {
    await runChild("engine", [], { ...handoff, shell: input.shell, captureStderr: input.captureStderr })
  } catch (error) { failure = error.message }
} else handoff?.onSpawn?.()
console.log(JSON.stringify({ inspected, handoff, closed, spawned, failure, helperTable }))
`], { encoding: "utf8" })
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout)
}

describe("Windows private descriptor pair contract (#11955)", () => {
  test("forwards Node Windows pipe modes even though Stats.isFIFO always returns false", () => {
    const result = inspect({ table: { a: [5, 6] }, windowsNodeStats: true, capture: true, spawn: "success" })
    expect(result.inspected).toEqual({ table: '{"a":[5,6]}', fds: [5, 6], discard: [] })
    expect(result.helperTable).toBeNull()
    expect(result.spawned.env.SENPI_PRIVATE_FDS).toBe('{"a":[5,6]}')
    expect(result.spawned.stdio.slice(5)).toEqual([5, 6])
    expect(result.closed).toEqual([5, 6])
  })

  test("forwards both open pipe halves on their original slots and closes owned copies", () => {
    const result = inspect({ table: { a: [5, 6] } })
    expect(result.inspected).toEqual({ table: '{"a":[5,6]}', fds: [5, 6], discard: [] })
    expect(result.handoff.env).toEqual({ KEEP: "yes", SENPI_PRIVATE_FDS: '{"a":[5,6]}' })
    expect(result.handoff.stdio).toEqual(["inherit", "inherit", "inherit", "ignore", "ignore", 5, 6])
    expect(result.closed).toEqual([5, 6])
  })

  test("accepts the Windows range through 64, not the POSIX ceiling of 15", () => {
    const result = inspect({ table: { a: [63, 64] }, pipes: [63, 64] })
    expect(result.inspected.fds).toEqual([63, 64])
    expect(result.handoff.stdio.slice(63)).toEqual([63, 64])
  })

  test("the first launcher import captures the pair without exposing it to helper environments", () => {
    const result = inspect({ table: { a: [5, 6] }, capture: true })
    expect(result.helperTable).toBeNull()
    expect(result.handoff.env.SENPI_PRIVATE_FDS).toBe('{"a":[5,6]}')
    expect(result.handoff.stdio.slice(5)).toEqual([5, 6])
    expect(result.closed).toEqual([5, 6])
  })

  // A refused entry's open, in-range pipe halves are discarded (closed) so the hop never keeps them.
  for (const [label, table, discard] of [
    ["one half", { a: [5] }, [5]],
    ["three halves", { a: [5, 6, 7] }, [5, 6]],
    ["equal halves", { a: [5, 5] }, [5]],
    ["below range", { a: [4, 6] }, [6]],
    ["above range", { a: [5, 65] }, [5]],
    ["fractional", { a: [5, 6.5] }, [5]],
    ["string half", { a: [5, "6"] }, [5]],
    ["bare integer", { a: 5 }, [5]],
    ["null", { a: null }, []],
    ["object", { a: { read: 5, write: 6 } }, []],
    ["pair alias", { a: [5, 6], b: [6, 7] }, [5, 6]],
    ["integer alias", { a: [5, 6], b: 5 }, [5, 6]],
    ["malformed third-element alias", { a: [5, 6], b: [8, 9, 6] }, [5, 6]],
  ] as const) {
    test(`refuses ${label} atomically while preserving declarations`, () => {
      const result = inspect({ table })
      expect(JSON.parse(result.inspected.table)).toEqual(Object.fromEntries(Object.keys(table).map(name => [name, null])))
      expect(result.inspected.fds).toEqual([])
      expect(result.inspected.discard).toEqual(discard)
      expect(result.handoff.stdio).toEqual(["inherit", "inherit", "inherit"])
      expect(result.closed).toEqual([])
    })
  }

  // The runtime IPC channel and anything that is not an open pipe are never discarded.
  for (const [label, options, discard] of [
    ["missing read half", { pipes: [6] }, [6]],
    ["missing write half", { pipes: [5] }, [5]],
    ["sockets", { pipes: [], sockets: [5, 6] }, []],
    ["non-pipes", { pipes: [] }, []],
    ["read IPC half", { ipc: 5 }, [6]],
    ["write IPC half", { ipc: 6 }, [5]],
    ["unidentified IPC channel", { ipc: "unknown" }, []],
  ] as const) {
    test(`refuses ${label} without forwarding either half`, () => {
      const result = inspect({ table: { a: [5, 6] }, ...options })
      expect(result.inspected).toEqual({ table: '{"a":null}', fds: [], discard })
    })
  }

  test("a shell receives null declarations and no pipe slots", () => {
    const result = inspect({ table: { a: [5, 6] }, shell: true })
    expect(result.handoff.env.SENPI_PRIVATE_FDS).toBe('{"a":null}')
    expect(result.handoff.stdio).toEqual(["inherit", "inherit", "inherit"])
    expect(result.closed).toEqual([5, 6])
  })

  for (const mode of ["success", "throw"] as const) {
    test(`the spawn boundary closes both owned copies on ${mode}`, () => {
      const result = inspect({ table: { a: [5, 6] }, spawn: mode })
      expect(result.spawned.stdio.slice(5)).toEqual([5, 6])
      expect(result.closed).toEqual([5, 6])
      expect(result.failure).toBe(mode === "throw" ? "spawn refused" : undefined)
    })
  }

  test("stderr capture preserves both private stdio slots", () => {
    const result = inspect({ table: { a: [5, 6] }, spawn: "success", captureStderr: true })
    expect(result.spawned.stdio).toEqual(["inherit", "inherit", "pipe", "ignore", "ignore", 5, 6])
    expect(result.closed).toEqual([5, 6])
  })

  test("the shell spawn boundary never receives either private half", () => {
    const result = inspect({ table: { a: [5, 6] }, spawn: "success", shell: true })
    expect(result.spawned.env.SENPI_PRIVATE_FDS).toBe('{"a":null}')
    expect(result.spawned.stdio).toEqual(["inherit", "inherit", "inherit"])
    expect(result.closed).toEqual([5, 6])
  })

  test("POSIX keeps array declarations null and its integer socket behavior unchanged", () => {
    const result = inspect({ platform: "linux", table: { a: [5, 6], socket: 7, high: 24 }, sockets: [7, 24] })
    expect(result.inspected).toEqual({ table: '{"a":null,"socket":7,"high":null}', fds: [7], discard: [24] })
    expect(result.closed).toEqual([])
  })
})
