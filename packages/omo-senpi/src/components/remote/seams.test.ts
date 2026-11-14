import { describe, expect, test } from "bun:test"
import { canonicalizeThreadHandle, describeThread } from "./seams"
import type { SessionRow } from "./types"

// Seam 1 (the only thread-address parser) and seam 2 (the only thread-naming helper), design v8-core r2 B1. The
// `<device>/<session>` form must match senpi's remote monitor target shape, and a local path must never read as a device.

describe("canonicalizeThreadHandle", () => {
  test("#given the monitor form #then it names a session on a device, trimmed", () => {
    expect(canonicalizeThreadHandle("  studio/c2Vz  ", { all_scope: true })).toEqual({
      kind: "ok",
      value: {
        handle: "studio/c2Vz",
        target: { kind: "device_session", device: "studio", session: "c2Vz" },
        scope: { all_scope: true },
      },
    })
  })

  test.each(["./notes/a", ".hidden/x", "~/x", "C:/x", "studio/run.jsonl", "/abs/x", "a/b/c", "build bot", "dur-1"])(
    "#given %p #then it stays an address for the resolver",
    (input) => {
      expect(canonicalizeThreadHandle(input, {})).toMatchObject({
        kind: "ok",
        value: { target: { kind: "address", address: input } },
      })
    },
  )

  test("#given empty text #then invalid_arguments, as data", () => {
    expect(canonicalizeThreadHandle("   ", {})).toMatchObject({ kind: "error", code: "invalid_arguments" })
  })
})

describe("describeThread", () => {
  const row = (name: string, title: string): SessionRow => ({
    thread: "studio/c2Vz",
    name,
    title,
    device: {
      id: "studio",
      name: "Studio",
      kind: "desktop",
      platform: "darwin",
      online: true,
      last_seen_ms: null,
      caps: { attach: true, machine: false, control: false },
    },
    project: "omo",
    path: "/home/u/omo",
    state: "idle",
    archived: false,
    updated_ms: 0,
    source: "live",
  })

  test("#given a name, only a title, or neither #then it names the thread by name, then title, then as untitled", () => {
    expect(describeThread(row("build", "Fix CI"))).toBe('"build" on Studio (studio/c2Vz)')
    expect(describeThread(row("", "Fix CI"))).toBe('"Fix CI" on Studio (studio/c2Vz)')
    expect(describeThread(row("", ""))).toBe('"untitled thread" on Studio (studio/c2Vz)')
  })
})
