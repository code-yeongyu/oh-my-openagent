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
  team: {
    prompt: "Render one structured team message, then remain interactive for visual inspection.",
    customMessages: [
      {
        customType: "senpi-task.team-message",
        content: '<peer_message from="member-alpha" timestamp="100" messageId="team-visual-1" kind="message" correlationId="" summary="검토 완료">\n한국어 팀 메시지 본문과 the actual review result are visible without protocol tags.\n</peer_message>',
        details: {
          from: "member-alpha",
          messageId: "team-visual-1",
          summary: "검토 완료",
          body: "한국어 팀 메시지 본문과 the actual review result are visible without protocol tags.",
        },
      },
    ],
    parentSteps: [{ type: "text", text: "team message renderer scenario complete" }],
    childSteps: [{ type: "text", text: "team scenario has no child" }],
  },
}

export function scenarioUsage() {
  return Object.keys(SCENARIOS).sort().join("|")
}
