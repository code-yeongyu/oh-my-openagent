// Real-surface proof for the dag planning gate: drive the actual dag tool start
// end-to-end against a real DagManager and print the exact model-visible result.
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createDagFileStore, createDagManager } from "@oh-my-opencode/senpi-task/dag"

import { runDagTool } from "../../src/components/task/dag-tool"

const projectDir = mkdtempSync(join(tmpdir(), "dag-gate-proof-"))
const store = createDagFileStore({ project_dir: projectDir })
const manager = createDagManager({ store })
const deps = { manager, parentSessionId: () => "ses-proof", rootSessionId: () => "ses-proof" }

const violating = await runDagTool(deps, {
  action: "start",
  definition: {
    key: "proof-violating",
    name: "proof violating",
    nodes: [
      { id: "plan", prompt: "draft the plan", category: "quick" },
      { id: "build", prompt: "build it", category: "quick", dependsOn: ["plan"] },
    ],
  },
})
console.log("=== violating definition: model-visible text ===")
console.log(violating.content[0]?.type === "text" ? violating.content[0].text : "(non-text)")
console.log("=== violating definition: warnings payload ===")
console.log(JSON.stringify(violating.details.kind === "started" ? violating.details.warnings : "(error)", null, 2))

const compliant = await runDagTool(deps, {
  action: "start",
  definition: {
    key: "proof-compliant",
    name: "proof compliant",
    nodes: [
      {
        id: "plan",
        prompt: "TASK: draft the plan. DELIVERABLE: plan.md. SCOPE: write plan.md only. VERIFY: test -f plan.md. STOP WHEN: plan.md exists.",
        category: "quick",
      },
      {
        id: "verify",
        prompt: "TASK: verify the plan. DELIVERABLE: transcript. SCOPE: read-only. VERIFY: bun test. STOP WHEN: tests pass.",
        category: "quick",
        dependsOn: ["plan"],
      },
    ],
  },
})
console.log("=== compliant definition: model-visible text ===")
console.log(compliant.content[0]?.type === "text" ? compliant.content[0].text : "(non-text)")
console.log("=== compliant definition: warnings payload ===")
console.log(JSON.stringify(compliant.details.kind === "started" ? compliant.details.warnings : "(error)"))
