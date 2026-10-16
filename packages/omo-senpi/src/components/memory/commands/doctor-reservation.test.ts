import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { hostname } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"

import { checkGhostReservation } from "./doctor-reservation"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function identityPathsWithActive(active: unknown) {
  const root = await mkdtemp(join(tmpdir(), "doctor-reservation-"))
  roots.push(root)
  const paths = buildIdentityPaths(root, "agent-test")
  const { mkdir } = await import("node:fs/promises")
  await mkdir(paths.reflection, { recursive: true })
  if (active !== undefined) {
    await writeFile(join(paths.reflection, "active.lock"), JSON.stringify(active))
  }
  return paths
}

const GHOST_ACTIVE = {
  runId: "reflection-run-1",
  reservedAt: "2026-08-18T07:01:33.240Z",
  launcherPid: 81327,
  launcherHostname: hostname(),
  launcherProcessStart: "ps-lstart:old",
  request: { trigger: "dream", origin: "shutdown", conversationIds: [], snapshots: [] },
}

describe("checkGhostReservation", () => {
  test("#given no active.lock #then the check is ok", async () => {
    const paths = await identityPathsWithActive(undefined)
    expect(await checkGhostReservation(paths, {})).toMatchObject({ name: "reservation", level: "ok" })
  })

  test("#given an old reservation with a dead launcher #then it warns with remediation", async () => {
    const paths = await identityPathsWithActive(GHOST_ACTIVE)
    const check = await checkGhostReservation(paths, { isProcessAlive: () => false })
    expect(check).toMatchObject({ name: "reservation", level: "warn" })
    expect(check.detail).toContain("reflection-run-1")
    expect(check.detail).toContain("81327")
  })

  test("#given an old reservation with a live launcher #then the check is ok", async () => {
    const paths = await identityPathsWithActive(GHOST_ACTIVE)
    expect(await checkGhostReservation(paths, { isProcessAlive: () => true })).toMatchObject({ level: "ok" })
  })

  test("#given a reservation owned by another host #then the check is ok", async () => {
    const paths = await identityPathsWithActive({ ...GHOST_ACTIVE, launcherHostname: "some-other-host" })
    expect(await checkGhostReservation(paths, { isProcessAlive: () => false })).toMatchObject({ level: "ok" })
  })

  test("#given a reservation missing launcher identity #then it warns about the legacy ghost", async () => {
    const paths = await identityPathsWithActive({ runId: "reflection-run-2", request: GHOST_ACTIVE.request })
    const check = await checkGhostReservation(paths, {})
    expect(check.level).toBe("warn")
    expect(check.detail).toContain("launcher identity missing")
  })

  test("#given an unreadable active.lock #then it warns about invalid JSON", async () => {
    const paths = await identityPathsWithActive(undefined)
    await writeFile(join(paths.reflection, "active.lock"), "{not json")
    const check = await checkGhostReservation(paths, {})
    expect(check.level).toBe("warn")
    expect(check.detail).toContain("not valid JSON")
  })
})
