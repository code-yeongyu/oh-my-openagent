#!/usr/bin/env node
// Scripted mock-model response sequences for team-e2e.mjs (todo 28). Each export is a MockScript: a
// Record<role, MockStep[]> the lane-private mock provider replays one step per turn, clamped to the
// last step for wake-triggered extra turns. Roles are keyed off the MOCKROLE=<role> marker the driver
// bakes into each member's spawn prompt (lead = the driver's own top-level prompt, which carries no
// marker). `__TEAM_RUN_ID__` / `__TASK_ID__` are resolved by the provider from the live tool-result
// text, so a static script can address the run team-core minted at runtime.
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

// Full team lifecycle drive. The lead creates a 2-member team (category quick + agent fixture),
// inspects it, settles the quick member to a terminal+resident state via task_wait so the lead->member
// send lands on the revive/steer path, runs the task claim/complete flow, exercises approve and reject
// shutdown, then force-deletes the run. The quick member reports to the lead (QUICK2LEAD) so the lead's
// senpi-task.team-message channel is proven; both members echo the lead envelope (LEAD2QUICK) when it
// arrives.
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
    toolCall("team_status", { team_run_id: "__TEAM_RUN_ID__" }),
    toolCall("task_wait", { targets: ["team:__TEAM_RUN_ID__:quick"], timeout_ms: 20000 }),
    toolCall("team_send_message", { team_run_id: "__TEAM_RUN_ID__", to: "quick", body: "LEAD2QUICK envelope for the quick member" }),
    toolCall("team_task_create", { team_run_id: "__TEAM_RUN_ID__", subject: "e2e task", description: "drive the claim and complete flow" }),
    toolCall("team_task_update", { team_run_id: "__TEAM_RUN_ID__", task_id: "__TASK_ID__", status: "claimed" }),
    toolCall("team_task_update", { team_run_id: "__TEAM_RUN_ID__", task_id: "__TASK_ID__", status: "in_progress" }),
    toolCall("team_task_update", { team_run_id: "__TEAM_RUN_ID__", task_id: "__TASK_ID__", status: "completed" }),
    toolCall("team_shutdown_request", { team_run_id: "__TEAM_RUN_ID__", member: "quick" }),
    toolCall("team_approve_shutdown", { team_run_id: "__TEAM_RUN_ID__", member: "quick" }),
    toolCall("team_shutdown_request", { team_run_id: "__TEAM_RUN_ID__", member: "fixture" }),
    toolCall("team_reject_shutdown", { team_run_id: "__TEAM_RUN_ID__", member: "fixture", reason: "keep working on the e2e task" }),
    toolCall("team_delete", { team_run_id: "__TEAM_RUN_ID__", force: true }),
    text("lead e2e lifecycle drive complete"),
  ],
  quick: [
    toolCall("team_send_message", { to: "lead", body: "QUICK2LEAD member report to the lead" }),
    text("quick member work complete"),
  ],
  fixture: [text("fixture member acknowledged")],
}

// Durability revive-drain drive (W3-V F1 escalation). The single dura member seeds one already-unread
// message into its own inbox on spawn, then finishes so it is completed+resident. The lead task_waits it
// to that terminal+resident state, then sends the durability payload: deliverToMember takes the revive
// path, whose on-revive injection drains the seeded backlog AND the current message to processed/, so the
// inbox settles to unread=0/reserved=0/processed>=2. A second send guards against the first landing while
// dura is momentarily still-running (steer, which would not drain the backlog).
export const DURA_REVIVE_SCRIPT = {
  lead: [
    toolCall("team_create", {
      inline_spec: { name: "durateam", members: [{ name: "dura", kind: "category", category: "dura", prompt: DURA_PROMPT }] },
    }),
    toolCall("task_wait", { targets: ["team:__TEAM_RUN_ID__:dura"], timeout_ms: 20000 }),
    toolCall("team_send_message", { team_run_id: "__TEAM_RUN_ID__", to: "dura", body: "DURA-DRAIN durability payload one" }),
    toolCall("task_wait", { targets: ["team:__TEAM_RUN_ID__:dura"], timeout_ms: 20000 }),
    toolCall("team_send_message", { team_run_id: "__TEAM_RUN_ID__", to: "dura", body: "DURA-DRAIN durability payload two" }),
    text("dura durability drive complete"),
  ],
  dura: [text("dura member seeded and complete")],
}

// Reclaim seed drive (D1). Boots a team with ONE member 'rcl' whose MOCKROLE is 'quick' (NOT 'dura', so
// the provider seeds no backlog into its inbox), then exits WITHOUT deleting the run so the team stays
// active on disk for the fresh-boot reclaim to sweep. The driver then plants an aged crash reservation in
// rcl's inbox and boots NOOP_SCRIPT, whose session_start reconcile must restore it to unread.
export const DURA_SEED_SCRIPT = {
  lead: [
    toolCall("team_create", {
      inline_spec: { name: "rclteam", members: [{ name: "rcl", kind: "category", category: "quick", prompt: RCL_PROMPT }] },
    }),
    text("reclaim seed team is active"),
  ],
  quick: [text("rcl member acknowledged")],
}

// Fresh-boot session with no team work: its only job is to trigger the component session_start reclaim
// that restores the aged crash reservation the driver planted.
export const NOOP_SCRIPT = {
  lead: [text("fresh boot for session_start reclaim")],
}
