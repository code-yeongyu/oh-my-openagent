import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { basename, dirname, join } from "node:path"

import { afterAll, describe, expect, test } from "bun:test"

import { MAX_SHARD_BIND_PATH } from "./shard-socket"
import { shortSocketDir } from "./short-socket-dir.test-support"

// Guards the platform contract every engine-spawning test relies on (#12557): whatever the runner's TMPDIR, the
// socket path a test hands the engine stays within senpi's MAX_SOCKET_PATH_BYTES, under a short hashed leaf that is
// unique per call, and a path that cannot fit even under /tmp fails naming the limit.
const LABEL = "short-socket-test"
const NAME = "h.sock"
const LEAF_BYTES = Buffer.byteLength("s0000-XXXXXX")

describe.skipIf(process.platform === "win32")("short engine socket dir (#12557)", () => {
  const root = process.platform === "win32" ? "" : mkdtempSync("/tmp/omo-sk-")
  afterAll(() => rmSync(root, { recursive: true, force: true }))
  const base = (...parts: string[]): string => {
    const dir = join(root, ...parts)
    mkdirSync(dir, { recursive: true })
    return dir
  }
  // `<root>/<pad>/<leaf>/h.sock` is exactly the limit for this pad length.
  const atLimitPad = MAX_SHARD_BIND_PATH - Buffer.byteLength(root) - 1 - LEAF_BYTES - 1 - Buffer.byteLength(NAME) - 1

  test.each([
    ["a short base", () => base("short"), "base"],
    ["a base whose socket path is exactly at the limit", () => base("a".repeat(atLimitPad)), "base"],
    ["a base one byte over the limit", () => base("b".repeat(atLimitPad + 1)), "/tmp"],
    ["an over-long base", () => base("r".repeat(120)), "/tmp"],
    ["an over-long base nested under the root suite's run root", () => base("r".repeat(60), "omo-test-run-XXXXXX", "deeper"), "/tmp"],
  ] as const)("#given %s #when a socket dir is made #then the socket fits the limit under a short hashed leaf", (_name, makeBase, parent) => {
    const runnerTmp = makeBase()
    const { dir, socket } = shortSocketDir(LABEL, NAME, runnerTmp)
    try {
      expect(dirname(dir)).toBe(parent === "base" ? runnerTmp : "/tmp")
      expect(basename(dir)).toMatch(/^s[0-9a-f]{4}-.{6}$/)
      expect(socket).toBe(join(dir, NAME))
      expect(Buffer.byteLength(socket)).toBeLessThanOrEqual(MAX_SHARD_BIND_PATH)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("#given two tests under one over-long TMPDIR #when each makes its socket dir #then the dirs differ", () => {
    const runnerTmp = base("u".repeat(120))
    const first = shortSocketDir(LABEL, NAME, runnerTmp)
    const second = shortSocketDir(LABEL, NAME, runnerTmp)
    try {
      expect(first.dir).not.toBe(second.dir)
    } finally {
      for (const { dir } of [first, second]) rmSync(dir, { recursive: true, force: true })
    }
  })

  test("#given a socket name too long even under /tmp #when a socket dir is requested #then it fails naming the limit", () => {
    expect(() => shortSocketDir(LABEL, `${"x".repeat(100)}.sock`, base("short"))).toThrow(`over the ${MAX_SHARD_BIND_PATH}-byte engine limit`)
  })
})
