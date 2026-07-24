import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { memberTaskMapPath, readMemberTaskMap, writeMemberTaskMap } from "./member-map"

let runtimeDir: string

beforeEach(() => {
  runtimeDir = mkdtempSync(join(tmpdir(), "senpi-member-map-"))
})

afterEach(() => {
  rmSync(runtimeDir, { recursive: true, force: true })
})

describe("member task map sidecar", () => {
  test("#given a written map #when read back #then the member -> task mapping round-trips", async () => {
    // given
    await writeMemberTaskMap(runtimeDir, { alpha: "st_000001", beta: "st_000002" })

    // when
    const map = await readMemberTaskMap(runtimeDir)

    // then
    expect(map).toEqual({ alpha: "st_000001", beta: "st_000002" })
    expect(existsSync(memberTaskMapPath(runtimeDir))).toBe(true)
  })

  test("#given no sidecar file #when read #then an empty map is returned", async () => {
    // when
    const map = await readMemberTaskMap(runtimeDir)

    // then
    expect(map).toEqual({})
  })

  test("#given a malformed sidecar #when read #then an empty map is returned", async () => {
    // given
    writeFileSync(memberTaskMapPath(runtimeDir), "{ not json", "utf8")

    // when
    const map = await readMemberTaskMap(runtimeDir)

    // then
    expect(map).toEqual({})
  })

  test("#given a completed write #when the directory is listed #then no temp file remains", async () => {
    // given
    await writeMemberTaskMap(runtimeDir, { alpha: "st_000001" })

    // when
    const entries = readdirSync(runtimeDir)

    // then
    expect(entries).toEqual(["senpi-task-members.json"])
  })

  test.skipIf(process.platform === "win32")("#given a completed write #when target is inspected #then rename preserves private mode", async () => {
    // given
    await writeMemberTaskMap(runtimeDir, { alpha: "st_000001" })

    // when
    const mode = statSync(memberTaskMapPath(runtimeDir)).mode & 0o777

    // then
    expect(mode).toBe(0o600)
  })
})
