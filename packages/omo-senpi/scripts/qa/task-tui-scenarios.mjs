export const OMO_CONFIG = {
  categories: {
    ultrabrain: { description: "Local mock ultrabrain category for TUI QA.", model: "omo-mock/mock-1", reasoningEffort: "xhigh" },
  },
}

export const SCENARIOS = {
  full: {
    prompt: "Use the omo task tools to spawn a background child, interrupt it, continue it, read its output, and cancel it.",
    parentSteps: [
      { type: "tool_call", name: "task", arguments: { category: "ultrabrain", prompt: "Inspect the isolated Senpi task lifecycle, report the initial result clearly, and remain ready for a continuation that verifies resident-session revival.", run_in_background: true, name: "tui-child" } },
      { type: "text", text: "tui parent observed the initial child completion" },
      { type: "tool_call", name: "task_send", arguments: { to: "tui-child", deliver_as: "interrupt" } },
      { type: "tool_call", name: "task_send", arguments: { to: "tui-child", deliver_as: "followUp", message: "Continue in the same resident child session, verify that revival preserved the initial task context, and produce a concise second-stage report describing what changed after the follow-up instruction." } },
      { type: "text", text: "tui parent observed the continuation completion" },
      { type: "tool_call", name: "task_output", arguments: { name: "tui-child", mode: "full", block: true } },
      { type: "tool_call", name: "task_cancel", arguments: { name: "tui-child", reason: "TUI QA cleanup after the complete transcript was captured" } },
      { type: "text", text: "tui full scenario complete" },
    ],
    childSteps: [
      { type: "text", text: "Initial child report: the isolated task lifecycle completed its first meaningful unit." },
      { type: "text", text: "Continuation child report: the resident session revived with its prior context and completed the follow-up unit." },
    ],
  },
  edge: {
    prompt: "Exercise the task-family renderer edge path at 72 columns, then remain interactive.",
    parentSteps: [
      { type: "tool_call", name: "task", arguments: { category: "missing-cat", prompt: "한국어로 긴 작업 지시를 작성하고 여러 줄의 혼합 폭 텍스트가 72열 터미널에서 안전하게 줄임표 처리되는지 확인하세요.\nThen inspect the missing-category routing error and summarize the English continuation without overflowing the interactive xterm row.", name: "edge-missing-child" } },
      { type: "tool_call", name: "task_send", arguments: { to: "edge-missing-child", message: " \n\t " } },
      { type: "tool_call", name: "task_send", arguments: { to: "edge-missing-child", deliver_as: "interrupt" } },
      { type: "tool_call", name: "task_send", arguments: { team_run_id: "edge-team-72", to: "edge-member", message: { type: "shutdown_request", reason: "Renderer QA request after the mixed Korean and English edge pass" } } },
      { type: "tool_call", name: "task_send", arguments: { team_run_id: "edge-team-72", to: "edge-member", message: { type: "shutdown_response", request_id: "edge-request-72", approve: false, reason: "Keep the member active until the compact renderer rows are verified" } } },
      { type: "tool_call", name: "task_output", arguments: { name: "edge-missing-child", mode: "status", block: false } },
      { type: "tool_call", name: "task_cancel", arguments: { name: "edge-missing-child", reason: " \n\t " } },
      { type: "text", text: "tui edge scenario complete" },
    ],
    childSteps: [{ type: "text", text: "edge child should not run" }],
  },
  active: {
    prompt: "Spawn one active background task, then stop so the task footer and widget can be captured while the child is still running.",
    parentSteps: [
      { type: "tool_call", name: "task", arguments: { category: "ultrabrain", prompt: "Run a long built-in bash command for active-task TUI visual proof, then wait for completion without summarizing early.", run_in_background: true, name: "active-child" } },
      { type: "text", text: "active scenario parent stopped while active-child continues" },
    ],
    childSteps: [{ type: "tool_call", name: "bash", arguments: { command: "sleep 30" } }],
  },
}

export function scenarioUsage() {
  return Object.keys(SCENARIOS).sort().join("|")
}

function toolCalls(scenario) {
  return scenario.parentSteps.filter((step) => step.type === "tool_call")
}

function toolNames(calls) {
  return calls.map((step) => step.name).join(",")
}

export function assertScenarioCoverage() {
  const required = ["active", "edge", "full"]
  const failures = []
  for (const name of required) {
    if (!Object.hasOwn(SCENARIOS, name)) failures.push(`${name} scenario`)
  }
  const configuredCategory = OMO_CONFIG.categories.ultrabrain
  if (configuredCategory?.model !== "omo-mock/mock-1" || configuredCategory.reasoningEffort !== "xhigh") failures.push("ultrabrain mock model config")
  if (failures.length === 0) assertFullCoverage(failures)
  if (failures.length === 0) assertEdgeCoverage(failures)
  if (failures.length === 0) assertActiveCoverage(failures)
  if (failures.length > 0) throw new Error(`self-test: scenario coverage missing: ${failures.join("; ")}`)
}

function assertFullCoverage(failures) {
  const full = toolCalls(SCENARIOS.full)
  if (toolNames(full) !== "task,task_send,task_send,task_output,task_cancel") failures.push("full tool sequence")
  const fullTask = full[0]?.arguments
  if (fullTask?.category !== "ultrabrain" || fullTask.run_in_background !== true || String(fullTask.prompt ?? "").trim().length < 60) failures.push("meaningful ultrabrain background task")
  const fullInterrupt = full[1]?.arguments
  if (fullInterrupt?.deliver_as !== "interrupt" || Object.hasOwn(fullInterrupt, "message")) failures.push("full pure interrupt")
  const fullFollowUp = full[2]?.arguments
  if (fullFollowUp?.deliver_as !== "followUp" || String(fullFollowUp.message ?? "").trim().length < 80) failures.push("long full follow-up")
  if (full[3]?.arguments?.block !== true) failures.push("blocking task_output")
  if (SCENARIOS.full.childSteps.filter((step) => step.type === "text").length < 2) failures.push("completion and revival child steps")
}

function assertEdgeCoverage(failures) {
  const edge = toolCalls(SCENARIOS.edge)
  if (toolNames(edge) !== "task,task_send,task_send,task_send,task_send,task_output,task_cancel") failures.push("edge tool sequence")
  const edgePrompt = String(edge[0]?.arguments?.prompt ?? "")
  if (edge[0]?.arguments?.category !== "missing-cat" || Object.hasOwn(edge[0]?.arguments ?? {}, "run_in_background") || !edgePrompt.includes("\n") || !/[가-힣]/u.test(edgePrompt) || !/[A-Za-z]/u.test(edgePrompt) || edgePrompt.length < 120) failures.push("foreground long multiline Korean/English task")
  const edgeWhitespaceSend = edge[1]?.arguments?.message
  const edgeInterrupt = edge[2]?.arguments
  if (typeof edgeWhitespaceSend !== "string" || edgeWhitespaceSend.length === 0 || edgeWhitespaceSend.trim().length !== 0) failures.push("whitespace-only task_send message")
  if (edgeInterrupt?.deliver_as !== "interrupt" || Object.hasOwn(edgeInterrupt, "message")) failures.push("edge pure interrupt")
  const shutdownRequest = edge[3]?.arguments
  const shutdownResponse = edge[4]?.arguments
  if (shutdownRequest?.message?.type !== "shutdown_request" || !shutdownRequest.team_run_id || !String(shutdownRequest.message.reason ?? "").trim()) failures.push("structured shutdown request")
  if (shutdownResponse?.message?.type !== "shutdown_response" || !shutdownResponse.team_run_id || !shutdownResponse.message.request_id || !String(shutdownResponse.message.reason ?? "").trim()) failures.push("structured shutdown response")
  const edgeCancelReason = edge[6]?.arguments?.reason
  if (typeof edgeCancelReason !== "string" || edgeCancelReason.length === 0 || edgeCancelReason.trim().length !== 0) failures.push("whitespace-only task_cancel reason")
  const edgeFinal = SCENARIOS.edge.parentSteps.at(-1)
  if (edgeFinal?.type !== "text" || edgeFinal.text !== "tui edge scenario complete") failures.push("stable edge text step")
}

function assertActiveCoverage(failures) {
  const active = toolCalls(SCENARIOS.active)
  if (toolNames(active) !== "task") failures.push("active tool sequence")
  const activeTask = active[0]?.arguments
  if (activeTask?.category !== "ultrabrain" || activeTask.run_in_background !== true || activeTask.name !== "active-child") failures.push("active background ultrabrain task")
  if (!String(activeTask?.prompt ?? "").includes("long built-in bash command")) failures.push("active clear task prompt")
  const parentFinal = SCENARIOS.active.parentSteps.at(-1)
  if (parentFinal?.type !== "text" || !parentFinal.text.includes("active-child continues")) failures.push("active parent stops after spawn")
  const childStep = SCENARIOS.active.childSteps[0]
  if (childStep?.type !== "tool_call" || childStep.name !== "bash" || childStep.arguments?.command !== "sleep 30") failures.push("active long-running child bash")
}
