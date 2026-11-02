import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createDagFileStore, createDagManager } from "@oh-my-opencode/senpi-task/dag"
import { runDagTool } from "./dag-tool"

test("#given an unresolved node input #when workflow send returns #then its identity and uncertain disposition survive the tool boundary", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dag-input-"))
  const manager = createDagManager({ store: createDagFileStore({ project_dir: dir }) })
  const deps = { manager, parentSessionId: () => "parent", rootSessionId: () => "parent" }
  try {
    const started = await runDagTool(deps, { action: "start", definition: {
      key: "input-probe", name: "input probe", nodes: [{ id: "work", prompt: "work", category: "quick" }],
    } })
    if (started.details.kind !== "started") throw new Error("DAG fixture did not start")
    const result = await runDagTool({
      ...deps, send: async (_, nodeId) => ({
        nodeId, taskId: "st_00000001", delivery: "uncertain", effectId: "st_00000001:0:2",
      }),
    }, { action: "send", run_id: started.details.run_id, node_id: "work", message: "continue" })
    expect(result.details).toMatchObject({
      kind: "sent", delivery: "uncertain", effect_id: "st_00000001:0:2",
    })
    expect(result.isError).not.toBe(true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
