import { afterEach, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createTaskRecordStore } from "../store"
import { createSteeringEngine } from "./engine"
import type { ReviveReservation } from "./types"
import { cleanupRoots, detachedTerminal, fakeHandle, portFor, roots } from "./__fixtures__/residency"

afterEach(cleanupRoots)

test("#given an already granted revival #when O9 routes a detached terminal through cold revival #then the same reservation is consumed without reacquisition", async () => {
  const root = mkdtempSync(join(tmpdir(), "senpi-granted-cold-revival-"))
  roots.push(root)
  const store = createTaskRecordStore({ project_dir: root })
  const record = detachedTerminal(store)
  const followUps: string[] = []
  const reasons: string[] = []
  const port = portFor(store, fakeHandle(record.task_id, followUps), reasons)
  let acquisitions = 0
  let commits = 0
  let releases = 0
  const reserve = (): ReviveReservation => {
    acquisitions += 1
    return { ok: false }
  }
  const granted: ReviveReservation = {
    ok: true,
    commit: () => { commits += 1 },
    release: () => { releases += 1 },
  }
  const engine = createSteeringEngine({ ...port, reserveForRevive: reserve, reserveForDetachedRevive: reserve })

  const result = await engine.sendToTask({ idOrName: record.task_id, callerSessionId: "parent", message: "next turn" }, granted)

  expect(result.kind).toBe("revived")
  expect(acquisitions).toBe(0)
  expect(commits).toBe(1)
  expect(releases).toBe(0)
  expect(reasons).toEqual(["revived"])
  expect(followUps).toEqual(["next turn"])
  expect(store.load(record.task_id)?.notification.run_epoch).toBe(record.notification.run_epoch + 1)
})
