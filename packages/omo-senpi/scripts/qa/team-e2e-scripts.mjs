#!/usr/bin/env node
const QUICK_PROMPT = "You are team member 'quick'. MOCKROLE=quick. Report to the lead, then finish."
const FIXTURE_PROMPT = "You are team member 'fixture'. MOCKROLE=fixture. Acknowledge, then finish."
const DURA_PROMPT = "You are team member 'dura'. MOCKROLE=dura. Seed your backlog, then finish."
const RCL_PROMPT = "You are team member 'rcl'. MOCKROLE=quick. Acknowledge, then finish."

function toolCall(name, args) {
  return { type: "tool_call", name, arguments: args }
}

function text(value) {
  return { type: "text", text: value }
}

export const LEAD_SCRIPT = {
  lead: [
    toolCall("team_create", {
      inline_spec: {
        name: "e2eteam",
        members: [
          { name: "quick", kind: "category", category: "quick", prompt: QUICK_PROMPT },
          { name: "fixture", kind: "subagent_type", subagent_type: "fixture", prompt: FIXTURE_PROMPT },
        ],
      },
    }),
    toolCall("task_output", { name: "team:__TEAM_RUN_ID__:quick", mode: "status", block: true, timeout_ms: 20000 }),
    toolCall("task_send", { team_run_id: "__TEAM_RUN_ID__", to: "quick", message: "LEAD2QUICK envelope for the quick member" }),
    toolCall("task_create", { team_run_id: "__TEAM_RUN_ID__", subject: "e2e task", description: "drive the claim and complete flow" }),
    toolCall("task_update", { team_run_id: "__TEAM_RUN_ID__", task_id: "__TASK_ID__", status: "claimed" }),
    toolCall("task_update", { team_run_id: "__TEAM_RUN_ID__", task_id: "__TASK_ID__", status: "in_progress" }),
    toolCall("task_update", { team_run_id: "__TEAM_RUN_ID__", task_id: "__TASK_ID__", status: "completed" }),
    toolCall("task_send", { team_run_id: "__TEAM_RUN_ID__", to: "quick", message: { type: "shutdown_request", reason: "quick finished the e2e work" } }),
    toolCall("task_send", { team_run_id: "__TEAM_RUN_ID__", to: "quick", message: { type: "shutdown_response", request_id: "ignored-by-senpi", approve: true } }),
    toolCall("task_output", { name: "team:__TEAM_RUN_ID__:quick", mode: "status", block: false }),
    toolCall("task_send", { team_run_id: "__TEAM_RUN_ID__", to: "fixture", message: { type: "shutdown_request", reason: "fixture shutdown probe" } }),
    toolCall("task_send", { team_run_id: "__TEAM_RUN_ID__", to: "fixture", message: { type: "shutdown_response", request_id: "ignored-by-senpi", approve: false, reason: "keep working on the e2e task" } }),
    toolCall("team_delete", { team_run_id: "__TEAM_RUN_ID__", force: true }),
    text("lead e2e lifecycle drive complete"),
  ],
  quick: [
    toolCall("task_send", { to: "lead", message: "QUICK2LEAD member report to the lead" }),
    text("quick member work complete"),
    { type: "hang" },
  ],
  fixture: [text("fixture member acknowledged")],
}

export const DURA_REVIVE_SCRIPT = {
  lead: [
    toolCall("team_create", {
      inline_spec: { name: "durateam", members: [{ name: "dura", kind: "category", category: "dura", prompt: DURA_PROMPT }] },
    }),
    toolCall("task_output", { name: "team:__TEAM_RUN_ID__:dura", mode: "status", block: true, timeout_ms: 20000 }),
    toolCall("task_send", { team_run_id: "__TEAM_RUN_ID__", to: "dura", message: "DURA-DRAIN durability payload one" }),
    toolCall("task_output", { name: "team:__TEAM_RUN_ID__:dura", mode: "status", block: true, timeout_ms: 20000 }),
    toolCall("task_send", { team_run_id: "__TEAM_RUN_ID__", to: "dura", message: "DURA-DRAIN durability payload two" }),
    text("dura durability drive complete"),
  ],
  dura: [text("dura member seeded and complete")],
}

export const DURA_SEED_SCRIPT = {
  lead: [
    toolCall("team_create", {
      inline_spec: { name: "rclteam", members: [{ name: "rcl", kind: "category", category: "quick", prompt: RCL_PROMPT }] },
    }),
    text("reclaim seed team is active"),
  ],
  quick: [text("rcl member acknowledged")],
}

export const NOOP_SCRIPT = {
  lead: [text("fresh boot for session_start reclaim")],
}
