import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths, runStaleLockReaper } from "@oh-my-opencode/memory-core"

import { createReflectionRunIdFactory } from "./reflection-run-id"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function identity() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "omo-run-id-torn-")))
  roots.push(root)
  const paths = buildIdentityPaths(root, "agent-a")
  mkdirSync(paths.reflection, { recursive: true })
  return paths
}

const probe = { hostname: () => "this-host", now: () => Date.parse("2026-11-05T06:00:00.000Z"), getPidLiveness: () => "dead" as const }

describe("run-id high water across a torn active.lock (#11976 C17)", () => {
  test("#given a torn active.lock naming reflection-run-66 and reflection-run-60 as the highest other trace #when the reaper moves it aside #then run-id.json records 66 and the next mint is reflection-run-67", async () => {
    // given
    const paths = identity()
    mkdirSync(join(paths.reflection, "runs", "reflection-run-60"), { recursive: true })
    utimesSync(join(paths.reflection, "runs", "reflection-run-60"), new Date("2026-11-05T04:00:00.000Z"), new Date("2026-11-05T04:00:00.000Z"))
    writeFileSync(join(paths.reflection, "active.lock"), "{\"runId\":\"reflection-run-66\",\"request\":{\"trig")
    utimesSync(join(paths.reflection, "active.lock"), new Date("2026-11-05T04:00:00.000Z"), new Date("2026-11-05T04:00:00.000Z"))

    // when
    await runStaleLockReaper({ runtimeDir: paths.runtime, probe })

    // then
    expect(JSON.parse(readFileSync(join(paths.reflection, "run-id.json"), "utf8"))).toMatchObject({ version: 1, highWater: 66 })
    expect(await createReflectionRunIdFactory({ identityPaths: paths })()).toBe("reflection-run-67")
  })

  test("#given a torn active.lock whose run id is cut mid-digit and no other trace #when the reaper moves it aside #then the truncated digits are not trusted and the next mint is reflection-run-1", async () => {
    // given
    const paths = identity()
    writeFileSync(join(paths.reflection, "active.lock"), "{\"runId\":\"reflection-run-6")
    utimesSync(join(paths.reflection, "active.lock"), new Date("2026-11-05T04:00:00.000Z"), new Date("2026-11-05T04:00:00.000Z"))

    // when
    await runStaleLockReaper({ runtimeDir: paths.runtime, probe })

    // then
    expect(await createReflectionRunIdFactory({ identityPaths: paths })()).toBe("reflection-run-1")
  })

  test("#given run-id.json records a high water above every trace on disk #when an id is minted #then it is one past the recorded mark", async () => {
    // given
    const paths = identity()
    mkdirSync(join(paths.reflection, "runs", "reflection-run-3"), { recursive: true })
    writeFileSync(join(paths.reflection, "run-id.json"), JSON.stringify({ version: 1, highWater: 41 }))

    // when
    const minted = await createReflectionRunIdFactory({ identityPaths: paths })()

    // then
    expect(minted).toBe("reflection-run-42")
  })
})
