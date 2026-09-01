import { buildCompletionDetails, buildCompletionMessage, DAG_VERIFICATION_DIRECTIVE } from "/private/tmp/ulw-wt-dag-directive/packages/senpi-task/src/completion/index"
const base: any = {
  task_id: "st_demo", name: "demo-node", status: "completed", residency_state: "resident",
  created_at: "2026-08-20T10:00:00.000Z", updated_at: "2026-08-20T10:01:00.000Z",
  parent_session_id: "sess", root_session_id: "sess", depth: 1, execution_mode: "in-process",
  model: "test-model", notify_on_terminal: true, notification: { run_epoch: 1, notified_epoch: 0 },
  final_response: "I finished everything, trust me.",
}
const dagRec: any = { ...base, owner: { kind: "dag", runId: "dag_run_demo", nodeId: "impl", fingerprint: "fp" } }
const dagMsg = buildCompletionMessage([buildCompletionDetails(dagRec)])
const plainMsg = buildCompletionMessage([buildCompletionDetails(base)])
const mixedMsg = buildCompletionMessage([buildCompletionDetails(base), buildCompletionDetails(dagRec), buildCompletionDetails(dagRec)])
console.log("=== DAG-OWNED message content ===")
console.log(dagMsg.content)
console.log("=== dag detail field ===", JSON.stringify((dagMsg.details[0] as any).dag))
console.log("=== PLAIN contains directive? ===", plainMsg.content.includes(DAG_VERIFICATION_DIRECTIVE))
console.log("=== MIXED directive count ===", mixedMsg.content.split("TREAT AS FALSE UNTIL YOU PROVE IT").length - 1)
