import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createNudgeStateStore, NUDGE_STATE_FILE, parseNudgeState } from "./state"
import { NUDGE_STATE_VERSION, type NudgeState } from "./types"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omo-nudge-state-"))
})

afterEach(() => {
  chmodSync(dir, 0o700)
  rmSync(dir, { recursive: true, force: true })
})

function sample(): NudgeState {
  return {
    schemaVersion: NUDGE_STATE_VERSION,
    autoShows: 2,
    lastShownAt: 1_700_000_000_000,
    nextEligibleAt: 1_700_600_000_000,
    decision: "snoozed",
    decidedAt: 1_700_000_000_000,
    writtenBy: "5.0.0-test",
  }
}

describe("the nudge state survives a round trip", () => {
  test("#given a written state #when read back #then every field is preserved", () => {
    // given
    const store = createNudgeStateStore(dir)

    // when
    expect(store.write(sample())).toBe(true)

    // then
    expect(store.read()).toEqual(sample())
  })

  test("#given no state file #when read #then it reports missing rather than throwing", () => {
    // given / when / then
    expect(createNudgeStateStore(dir).read()).toBe("missing")
  })
})

describe("a damaged state file never crashes the session", () => {
  test.each([
    ["unparseable json", "{not json"],
    ["a json array", "[]"],
    ["a decision outside the enum", JSON.stringify({ decision: "maybe", nextEligibleAt: 1 })],
    ["a missing schedule", JSON.stringify({ decision: "none" })],
    ["a negative schedule", JSON.stringify({ decision: "none", nextEligibleAt: -1 })],
  ])("#given %s #when parsed #then it reports corrupt", (_label: string, raw: string) => {
    // given / when / then
    expect(parseNudgeState(raw)).toBe("corrupt")
  })

  test("#given a valid decision with junk siblings #when parsed #then the decision survives and junk is defaulted", () => {
    // given
    const raw = JSON.stringify({ decision: "never", nextEligibleAt: 10, autoShows: -5, lastShownAt: "x" })

    // when
    const parsed = parseNudgeState(raw)

    // then
    expect(parsed).not.toBe("corrupt")
    expect(parsed === "corrupt" || parsed === "missing" ? null : parsed.decision).toBe("never")
    expect(parsed === "corrupt" || parsed === "missing" ? null : parsed.autoShows).toBe(0)
  })
})

describe("writability is probed rather than assumed", () => {
  test("#given a writable directory #when probed #then it reports writable and leaves no probe file", () => {
    // given
    const store = createNudgeStateStore(dir)

    // when
    const writable = store.probeWritable()

    // then
    expect(writable).toBe(true)
    expect(createNudgeStateStore(dir).read()).toBe("missing")
  })

  test("#given a store path whose parent is a file #when probed #then it reports unwritable instead of throwing", () => {
    // given - mkdir/open under a regular file fails with ENOTDIR/ENOENT on every platform, including Windows
    const notADir = join(dir, "not-a-dir")
    writeFileSync(notADir, "")
    const locked = join(notADir, "locked")

    // when
    const writable = createNudgeStateStore(locked).probeWritable()

    // then
    expect(writable).toBe(false)
  })

  test("#given a store path whose parent is a file #when a write is attempted #then it returns false rather than throwing", () => {
    // given - mkdir/open under a regular file fails with ENOTDIR/ENOENT on every platform, including Windows
    const notADir = join(dir, "not-a-dir")
    writeFileSync(notADir, "")
    const locked = join(notADir, "locked-write")

    // when / then
    expect(createNudgeStateStore(locked).write(sample())).toBe(false)
  })

  // POSIX mode bits do not make a directory unwritable on Windows (Node chmod only toggles the file read-only attribute).
  test.skipIf(process.platform === "win32")("#given a read-only directory #when probed #then it reports unwritable instead of throwing", () => {
    // given
    const locked = join(dir, "locked")
    mkdirSync(locked, { recursive: true })
    chmodSync(locked, 0o500)

    // when
    const writable = createNudgeStateStore(locked).probeWritable()

    // then
    expect(writable).toBe(false)
  })

  // POSIX mode bits do not make a directory unwritable on Windows (Node chmod only toggles the file read-only attribute).
  test.skipIf(process.platform === "win32")("#given a read-only directory #when a write is attempted #then it returns false rather than throwing", () => {
    // given
    const locked = join(dir, "locked-write")
    mkdirSync(locked, { recursive: true })
    chmodSync(locked, 0o500)

    // when / then
    expect(createNudgeStateStore(locked).write(sample())).toBe(false)
  })
})

describe("the state file is written where the hook looks for it", () => {
  test("#given a written state #when the file is inspected #then it carries the documented name", () => {
    // given
    createNudgeStateStore(dir).write(sample())

    // when
    const raw = Bun.file(join(dir, NUDGE_STATE_FILE))

    // then
    expect(raw.size).toBeGreaterThan(0)
  })

  test("#given a file written by a future version #when read #then unknown fields do not make it corrupt", () => {
    // given
    writeFileSync(
      join(dir, NUDGE_STATE_FILE),
      JSON.stringify({ ...sample(), somethingNew: true, schemaVersion: 99 }),
    )

    // when
    const parsed = createNudgeStateStore(dir).read()

    // then
    expect(parsed).not.toBe("corrupt")
  })
})
