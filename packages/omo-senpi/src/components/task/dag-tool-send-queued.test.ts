import { expect, onTestFinished, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createDagFileStore, createDagManager } from "@oh-my-opencode/senpi-task/dag"
import { runDagTool } from "./dag-tool"

test("#given a queued node send #when the workflow tool reports acceptance #then it reports pending delivery rather than host receipt", async () => {
  const root = mkdtempSync(join(tmpdir(), "dag-send-queued-"))
  onTestFinished(() => rmSync(root, { recursive: true, force: true }))
  const manager = createDagManager({ store: createDagFileStore({ project_dir: root }) })
  const deps = { manager, parentSessionId: () => "parent", rootSessionId: () => "parent" }
  const started = await runDagTool(deps, {
    action: "start",
    definition: { key: "queued-send", name: "queued send", nodes: [{ id: "plan", prompt: "plan", category: "quick" }] },
  })
  if (started.details.kind !== "started") throw new Error("run did not start")

  const result = await runDagTool({
    ...deps,
    send: async (_runId, nodeId) => ({ nodeId, taskId: "task-queued", delivery: "queued", queuePosition: 2 }),
  }, { action: "send", run_id: started.details.run_id, node_id: "plan", message: "additional context" })

  expect(result.details).toMatchObject({ kind: "sent", delivery: "queued", queue_position: 2, task_id: "task-queued" })
  const text = result.content.flatMap(part => part.type === "text" ? [part.text] : []).join("\n")
  expect(text).toMatch(/queued|pending/i)
  expect(text).not.toMatch(/\bdelivered\b/i)
})
