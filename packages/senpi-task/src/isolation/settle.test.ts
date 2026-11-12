import { expect, test } from "bun:test"
import type { TaskIsolationSpec } from "../state"
import type { CoreMergeResult, IsolationHandle, IsolationRuntime, WorktreeBaseline } from "./runtime"
import { settleIsolation } from "./settle"

// A clone whose patch could not land was retained even when the child had already pushed every
// commit: 8 of 14 retained clones on one machine held nothing a remote lacked (2026-11-09).
function runtimeWith(kind: CoreMergeResult["kind"], workIsOnRemote: boolean) {
  const calls: string[] = []
  const runtime = {
    captureDelta: async () => ({ rootPatch: "diff --git a/f b/f\n", nestedPatches: [] }),
    merge: async (): Promise<CoreMergeResult> =>
      ({
        kind,
        changes_applied: kind === "applied",
        summary_path: "summary.json",
        files_changed: 1,
      }) as CoreMergeResult,
    retain: async () => {
      calls.push("retain")
      return "retained-path"
    },
    cleanup: async () => {
      calls.push("cleanup")
    },
    workIsOnRemote: async () => {
      calls.push("workIsOnRemote")
      return workIsOnRemote
    },
  } as unknown as IsolationRuntime
  return { runtime, calls }
}

const settle = (runtime: IsolationRuntime) =>
  settleIsolation({
    runtime,
    stateDir: "/state",
    taskId: "t1",
    isolation: { merged_dir: "/clone/m", mode: "patch", apply: true } as unknown as TaskIsolationSpec,
    merge: true,
    baseline: { root: {}, nested: [] } as unknown as WorktreeBaseline,
    handle: {} as IsolationHandle,
  })

test("a not-applied clone whose work is all on a remote is cleaned up, not retained", async () => {
  const { runtime, calls } = runtimeWith("not-applied", true)
  const result = await settle(runtime)
  expect(result.kind).toBe("not-applied")
  expect(calls).toEqual(["workIsOnRemote", "cleanup"])
})

test("a not-applied clone that still holds unique work is retained", async () => {
  const { runtime, calls } = runtimeWith("not-applied", false)
  await settle(runtime)
  expect(calls).toEqual(["workIsOnRemote", "retain"])
})

test("an applied clone is cleaned up without asking", async () => {
  const { runtime, calls } = runtimeWith("applied", false)
  await settle(runtime)
  expect(calls).toEqual(["cleanup"])
})
