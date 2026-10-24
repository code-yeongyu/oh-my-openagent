import { afterEach, expect, test } from "bun:test"
import { cleanupProjects } from "../../../../senpi-task/src/manager/__fixtures__/manager-fakes"
import { pausedRun } from "../../../../senpi-task/src/dag/__fixtures__/paused-run"
import { createDagManager } from "../../../../senpi-task/src/dag/manager"
import { controlJournal } from "../../../../senpi-task/src/dag/node-control-context"
import { runDagTool } from "./dag-tool"
import type { DagToolDeps } from "./dag-tool-contract"

afterEach(cleanupProjects)

test.each([
  { frozen: false, remove: false, node: false },
  { frozen: false, remove: true, node: true },
  { frozen: true, remove: false, node: true },
  { frozen: true, remove: true, node: false },
])("workflow guide journals draft changes and refuses frozen changes: %j", async input => {
  const h = await pausedRun()
  const manager = createDagManager({ store: h.store })
  const { initialRecord: _initial, ...schedulerOptions } = h.options
  const deps: DagToolDeps = {
    manager, parentSessionId: () => "parent-1", rootSessionId: () => "parent-1",
    guide: async (runId, command) => {
      const { createDagRuntimeControls } = await import("./dag-runtime-controls")
      const controls = createDagRuntimeControls({
        coreManager: manager, schedulerOptions, schedulers: new Map(), sessionId: () => "parent-1",
        controller: () => { throw new Error("guidance must not create a scheduler") },
        adoptReentry: () => { throw new Error("guidance must not adopt a scheduler") },
        clearAdmissionLatch: () => undefined,
      })
      return controls.guide(runId, command)
    },
  }
  try {
    const created = await runDagTool(deps, {
      action: "guide", run_id: h.runId, text: "first", ...(input.node ? { node_id: h.b } : {}),
    })
    expect(created?.details).toMatchObject({ kind: "guided" })
    if (created?.details.kind !== "guided") throw new Error("guidance creation failed")
    const guidance = created.details.guidance
    if (input.frozen) {
      const record = h.read()
      controlJournal({ ...h.options, initialRecord: record }, record).append({
        type: "dag.guidance.dispatching", guidance: { ...guidance, state: "dispatching" },
      })
    }
    const result = await runDagTool(deps, {
      action: "guide", run_id: h.runId, guidance_id: guidance.id,
      ...(input.remove ? { remove: true } : { text: "second" }),
    })
    if (input.frozen) {
      expect(result.details).toMatchObject({ kind: "error", error: { code: "guidance_frozen" } })
      expect(h.read().guidance).toMatchObject([{ revision: 0, state: "dispatching", text: "first" }])
    } else {
      expect(result.details).toMatchObject({
        kind: "guided", guidance: { revision: 1, state: input.remove ? "removed" : "draft", text: input.remove ? "first" : "second" },
      })
      expect(h.read().guidance).toMatchObject([{
        revision: 1, state: input.remove ? "removed" : "draft",
        scope: input.node ? { kind: "node", nodeId: h.b } : { kind: "run" },
      }])
    }
    expect(h.read().status).toBe("paused")
    expect(h.inProcess.startedSpecs).toHaveLength(1)
    expect(h.inProcess.handles.get(h.taskId)?.steerCalls).toEqual([])
  } finally { await h.manager.cancelTask(h.taskId) }
})
