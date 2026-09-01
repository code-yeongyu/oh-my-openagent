#!/usr/bin/env node
const QUICK_PROMPT = "You are team member 'quick'. MOCKROLE=quick. Report to the lead when injected work arrives, then end your turn."
const FIXTURE_PROMPT = "You are team member 'fixture'. MOCKROLE=fixture. Acknowledge, then finish."
const DURA_PROMPT = "You are team member 'dura'. MOCKROLE=dura. Seed your backlog, then end your turn."
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
      team_name: "stale-named-team",
      inline_spec: {
        name: "e2eteam",
        members: [
          { name: "quick", kind: "category", category: "quick", prompt: QUICK_PROMPT },
          { name: "fixture", kind: "subagent_type", subagent_type: "fixture", prompt: FIXTURE_PROMPT },
        ],
      },
    }),
    toolCall("task_send", { team_run_id: "__TEAM_RUN_ID__", to: "quick", message: "LEAD2QUICK injected handshake: report QUICK2LEAD after this arrives" }),
    toolCall("task_list", { team_run_id: "__TEAM_RUN_ID__" }),
  ],
  quick: [
    text("quick initial turn ended; waiting for an injected lead message"),
    toolCall("task_send", { to: "lead", message: "QUICK2LEAD member report delivered by injection" }),
    { type: "hang" },
  ],
  fixture: [text("fixture member acknowledged")],
}

export const DURA_REVIVE_SCRIPT = {
  lead: [
    toolCall("team_create", {
      inline_spec: { name: "durateam", members: [{ name: "dura", kind: "category", category: "dura", prompt: DURA_PROMPT }] },
    }),
    toolCall("task_send", { team_run_id: "__TEAM_RUN_ID__", to: "dura", message: "DURA-DRAIN durability payload one" }),
    toolCall("task_send", { team_run_id: "__TEAM_RUN_ID__", to: "dura", message: "DURA-DRAIN durability payload two" }),
    { type: "hang" },
  ],
  dura: [text("dura member seeded and initial turn ended")],
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

export const CRASH_RESTART_SCRIPT = {
  lead: [{ type: "wait_for_liveness" }],
}

// Print mode exits the moment its scripted turns settle, while the member mailbox poller only ticks
// on 1s intervals and the ack scanner commits only after the injected envelope reaches the session
// JSONL at a tool boundary. Two tool-held waits keep the turn (and therefore the process) alive
// across exactly those boundaries: reservation first, durable processed commit second.
export function crashReplacementScript(unreadPath, processedPath) {
  return {
    quick: [
      toolCall("bash", { command: waitForPathCommand(unreadPath, "absent") }),
      toolCall("bash", { command: waitForPathCommand(processedPath, "present") }),
      text("replacement crash message recovered"),
    ],
  }
}

function waitForPathCommand(path, mode) {
  const hit = mode === "present" ? "fs.existsSync(p)" : "!fs.existsSync(p)"
  const script = `const fs=require('fs');const p=process.argv[1];const until=Date.now()+25000;(function poll(){if(${hit})process.exit(0);if(Date.now()>until){console.error('timed out waiting for '+p);process.exit(1)}setTimeout(poll,100)})()`
  return `node -e "${script}" ${JSON.stringify(path)}`
}

export const CRASH_SEED_SCRIPT = {
  lead: [
    toolCall("team_create", {
      inline_spec: {
        name: "crashteam",
        members: [{ name: "crash", kind: "category", category: "quick", prompt: "You are team member 'crash'. MOCKROLE=quick. End your turn, then accept one crash-window injection." }],
      },
    }),
    toolCall("task_send", { team_run_id: "__TEAM_RUN_ID__", to: "crash", message: "CRASH-ONCE inject exactly once" }),
    toolCall("task_list", { team_run_id: "__TEAM_RUN_ID__" }),
  ],
  quick: [text("crash member ready and idle"), text("crash message observed")],
}
