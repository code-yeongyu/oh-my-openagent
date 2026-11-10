// What a person at the TUI sees for each thread tool row (#12994): one call line, one outcome line and a few short
// details, never the delivery id, message_seq or a full uuid on success; errors keep their code, message and next
// action; the expanded view adds the full structured result. Expectations are literal strings over real result shapes.
import { describe, expect, test } from "bun:test"

import type { Theme, ThemeColor } from "@code-yeongyu/senpi"

import type { ThreadToolName, ThreadToolResult } from "../contracts"
import { threadLink } from "../thread-link"
import { renderThreadCall, renderThreadResult } from "./render"

const PLAIN = { fg: (_color: ThemeColor, text: string) => text, bold: (text: string) => text } as unknown as Theme
const WIDE = 200
const PEER = "01a1c470-59fa-78ac-a032-1fc1ed6c6d66"
const DELIVERY = "9f6c2b1e-4d3a-4e8b-9c71-2a5f0e7d8c90"

function call(name: ThreadToolName, args: Record<string, unknown>): string[] {
  return trimmed(renderThreadCall(name)(args as never, PLAIN, { args } as never).render(WIDE))
}

/** The row component pads every line to the width; the assertions read what is drawn. */
function trimmed(lines: string[]): string[] {
  return lines.map((line) => line.trimEnd())
}

function result(name: ThreadToolName, value: ThreadToolResult, args: Record<string, unknown> = {}, expanded = false): string[] {
  const output = { content: [{ type: "text" as const, text: JSON.stringify(value) }], details: { result: value } }
  return trimmed(renderThreadResult(name)(output, { expanded, isPartial: false }, PLAIN, { args, isError: false } as never).render(WIDE))
}

const failed = (code: string, message: string, next: string): ThreadToolResult =>
  ({ kind: "error", error: { code, message, next_action: next } }) as ThreadToolResult

describe("thread tool call lines", () => {
  test.each([
    ["thread_send", { thread: PEER, message: "please review the PR\nsecond line" }, 'thread_send -> 01a1c470 "please review the PR"'],
    ["thread_send", { thread: "planner", message: "go" }, 'thread_send -> planner "go"'],
    ["thread_handoff", { thread: "plan", message: "resume from step 3", match: "fuzzy" }, 'thread_handoff -> plan "resume from step 3"'],
    ["thread_read", { thread: "self" }, "thread_read this thread"],
    ["thread_list", {}, "thread_list"],
    ["thread_list", { all_scope: true }, "thread_list all workspaces"],
    ["thread_create", { name: "scratch" }, 'thread_create "scratch"'],
    ["thread_create", {}, "thread_create new thread"],
    ["thread_create", { thread: PEER }, "thread_create open 01a1c470"],
    ["thread_create", { fork_from: PEER, name: "fork" }, 'thread_create fork 01a1c470 as "fork"'],
    ["thread_interrupt", { thread: "planner" }, "thread_interrupt planner"],
    ["thread_close", { thread: PEER }, "thread_close 01a1c470"],
    ["thread_rename", { thread: "planner", name: "reviewer" }, 'thread_rename planner -> "reviewer"'],
    ["thread_set_model", { thread: "planner", model: "openai/gpt-x" }, "thread_set_model planner -> openai/gpt-x"],
    ["thread_set_reasoning", { thread: "planner", level: "high", scope: "turn" }, "thread_set_reasoning planner -> high (this turn)"],
    ["thread_bind", { platform: "discord", account_id: "bot", chat_id: "c-42" }, "thread_bind discord c-42 -> this thread"],
    ["thread_unbind", { binding_id: DELIVERY, expected_revision: 2 }, "thread_unbind 9f6c2b1e"],
    ["thread_rebind", { binding_id: "bnd-7", expected_revision: 1, session: "planner" }, "thread_rebind bnd-7 -> planner"],
    ["thread_bindings", {}, "thread_bindings"],
    ["thread_report", { kind: "question", text: "ship it?\nmore" }, 'thread_report question "ship it?"'],
    ["thread_outbox", { binding_id: "bnd-7" }, "thread_outbox bnd-7"],
    ["thread_outbox_ack", { binding_id: "bnd-7", cursor: 12 }, "thread_outbox_ack bnd-7 through #12"],
    ["thread_answer", { binding_id: "bnd-7", reply_token: "tok", answer: "yes" }, 'thread_answer "yes"'],
  ] as const)("#given %s args #when the call renders #then it is one line: verb, target, message head", (name, args, expected) => {
    expect(call(name, args)).toEqual([expected])
  })

  test("#given a call whose arguments are still streaming #when it renders #then it shows the verb alone", () => {
    expect(call("thread_send", {})).toEqual(["thread_send"])
  })
})

describe("thread_send / thread_handoff results", () => {
  const sendArgs = { thread: PEER, message: "hi" }
  const sent = (delivery: Record<string, unknown>, extra: Record<string, unknown> = {}): ThreadToolResult =>
    ({ kind: "ok", thread_id: PEER, link: threadLink(PEER, "planner"), delivery, message_seq: 62, deduplicated: false, delivery_id: DELIVERY, effective_mode: "follow_up", endpoint: { kind: "tui" }, ...extra }) as ThreadToolResult

  test("#given a delivery that started a turn #when it renders #then one outcome line names the thread and the turn only", () => {
    expect(result("thread_send", sent({ kind: "started", turn_id: "306" }), sendArgs)).toEqual(["-> planner  follow-up delivered (turn 306)"])
  })

  test("#given a steered delivery #when it renders #then it says it joined the running turn", () => {
    expect(result("thread_send", sent({ kind: "steered", turn_id: "12" }, { effective_mode: "steer" }), sendArgs)).toEqual(["-> planner  steered into the running turn (turn 12)"])
  })

  test("#given a queued delivery #when it renders #then it says where it waits", () => {
    expect(result("thread_send", sent({ kind: "queued", queue_position: 2 }), sendArgs)).toEqual(["-> planner  queued #2: waits for the running turn"])
  })

  test("#given an offline target #when it renders #then it says the message waits for the thread to start", () => {
    const offline = { kind: "ok", thread_id: PEER, link: threadLink(PEER, undefined), delivery: { kind: "queued_offline", queue_position: 1 }, message_seq: 3, deduplicated: true, delivery_id: DELIVERY, effective_mode: "auto", endpoint: null } as ThreadToolResult
    expect(result("thread_send", offline, { thread: "reviewer", message: "hi" })).toEqual([
      "-> reviewer  queued #1: thread is offline, delivers when it starts",
      "  already sent under this key; not delivered twice",
    ])
  })

  test("#given a send to another device #when it renders #then the device is a detail line", () => {
    const remote = { kind: "ok", thread_id: PEER, link: threadLink(PEER, "builder"), delivery: { kind: "started", turn_id: "4" }, deduplicated: false, device: "laptop" } as ThreadToolResult
    expect(result("thread_send", remote, sendArgs)).toEqual(["-> builder  delivered (turn 4)", "  on device laptop"])
  })

  test("#given any successful send #when it renders collapsed #then no delivery id, message_seq or full uuid reaches the screen", () => {
    const text = result("thread_send", sent({ kind: "started", turn_id: "306" }), sendArgs).join("\n")
    expect(text).not.toContain(DELIVERY)
    expect(text).not.toContain(PEER)
    expect(text).not.toContain("62")
  })

  test("#given a fuzzy handoff #when it renders #then the matched thread and the match kind show", () => {
    const handed = { kind: "ok", thread: { thread_id: PEER, name: "planner-2", status: "live", cwd: "/w", created_at: "t", updated_at: null, link: threadLink(PEER, "planner-2") }, resolved_by: "fuzzy", delivery: { kind: "started", turn_id: "9" }, message_seq: 1, deduplicated: false, delivery_id: DELIVERY, effective_mode: "auto" } as ThreadToolResult
    expect(result("thread_handoff", handed, { thread: "plan", message: "go", match: "fuzzy" })).toEqual(["-> planner-2  delivered (turn 9)", "  matched by fuzzy name"])
  })

  test("#given a refused send #when it renders #then the error code, message and next action stay visible", () => {
    expect(result("thread_send", failed("not_found", "No thread named reviewer.", "Call thread_list and retry."), sendArgs)).toEqual([
      "failed: not_found - No thread named reviewer.",
      "  next: Call thread_list and retry.",
    ])
  })

  test("#given the expanded view #when a send renders #then the full structured result follows the summary", () => {
    const value = sent({ kind: "started", turn_id: "306" })
    const lines = result("thread_send", value, sendArgs, true)
    expect(lines[0]).toBe("-> planner  follow-up delivered (turn 306)")
    expect(JSON.parse(lines.slice(1).join("\n"))).toEqual(value)
  })
})

describe("thread_read / thread_list / thread_create results", () => {
  test("#given a transcript #when thread_read renders #then it counts messages and shows the latest one's first line", () => {
    const read = { kind: "ok", thread_id: PEER, link: threadLink(PEER, "planner"), items: [
      { seq: 1, role: "user", content: "start" },
      { seq: 2, role: "tool", content: "{...}" },
      { seq: 3, role: "assistant", content: "Done: merged #12\nDetails follow" },
    ], truncated: true, next_cursor: "c2", source: "session_jsonl", source_incomplete: true } as ThreadToolResult
    expect(result("thread_read", read, { thread: PEER })).toEqual([
      "planner: 2 messages (latest: Done: merged #12)",
      "  older messages not shown",
      "  read from the session file; may lag the live thread",
    ])
  })

  test("#given an empty transcript #when thread_read renders #then it says so", () => {
    const read = { kind: "ok", thread_id: PEER, link: threadLink(PEER, undefined), items: [], truncated: false, source: "live_host" } as ThreadToolResult
    expect(result("thread_read", read, { thread: PEER })).toEqual(["01a1c470: no messages"])
  })

  test("#given listed threads #when thread_list renders #then a count and the first few threads show", () => {
    const thread = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ thread_id: id, name, status: "live", cwd: "/w", created_at: "t", updated_at: null, link: threadLink(id, name), ...extra })
    const listed = { kind: "ok", scope: "workspace", threads: [
      thread("a", "planner", { surface: "tui" }),
      thread("b", "", { status: "resumable" }),
      thread("c", "builder", { surface: "desktop", device: "laptop", alive: false }),
      thread("d", "four"), thread("e", "five"), thread("f", "six"), thread("g", "seven"),
    ], remote_unavailable: "relay_requires_paid_plan" } as ThreadToolResult
    expect(result("thread_list", listed)).toEqual([
      "7 threads in this workspace",
      "  planner  live, tui",
      "  b  resumable",
      "  builder  live, desktop, laptop, not answering",
      "  four  live",
      "  five  live",
      "  ... 2 more",
      "  other devices unavailable: relay_requires_paid_plan",
    ])
  })

  test("#given no threads across all workspaces #when thread_list renders #then it says none", () => {
    expect(result("thread_list", { kind: "ok", scope: "all", threads: [] } as ThreadToolResult)).toEqual(["no threads in any workspace"])
  })

  test("#given a created thread #when thread_create renders #then it names the thread and its skills", () => {
    const created = { kind: "ok", thread: { thread_id: PEER, name: "scratch", status: "live", cwd: "/w", created_at: "t", updated_at: null, link: threadLink(PEER, "scratch"), requested_skills: ["git-master"] }, deduplicated: false } as ThreadToolResult
    expect(result("thread_create", created, { name: "scratch" })).toEqual(["created scratch", "  skills: git-master"])
  })

  test("#given an existing live thread #when thread_create opens it #then it says it was already open", () => {
    const opened = { kind: "ok", thread: { thread_id: PEER, name: "scratch", status: "live", cwd: "/w", created_at: "t", updated_at: null, link: threadLink(PEER, "scratch") }, deduplicated: true } as ThreadToolResult
    expect(result("thread_create", opened, { thread: PEER })).toEqual(["scratch is already open"])
  })

  test("#given a name conflict #when thread_create renders #then the error stays specific", () => {
    expect(result("thread_create", failed("name_conflict", 'A thread named "scratch" already exists.', "Call thread_list and choose another name."), { name: "scratch" })).toEqual([
      'failed: name_conflict - A thread named "scratch" already exists.',
      "  next: Call thread_list and choose another name.",
    ])
  })
})

describe("control and relay results", () => {
  test.each([
    ["thread_interrupt", { kind: "ok", thread_id: PEER, turn_id: "7", interrupted: true }, { thread: "planner" }, ["interrupted planner (turn 7)"]],
    ["thread_interrupt", { kind: "ok", thread_id: PEER, interrupted: false }, { thread: PEER }, ["01a1c470 was idle; nothing to interrupt"]],
    ["thread_close", { kind: "ok", thread_id: PEER, closed: true }, { thread: "planner" }, ["closed planner"]],
    ["thread_close", { kind: "ok", thread_id: PEER, closed: false }, { thread: "planner" }, ["planner was not running; nothing to close"]],
    ["thread_rename", { kind: "ok", thread_id: PEER, name: "reviewer", alias: "rev" }, { thread: "planner", name: "reviewer", alias: "rev" }, ['renamed to "reviewer"', "  alias: rev"]],
    ["thread_set_model", { kind: "ok", thread_id: PEER, model: { provider: "openai", id: "gpt-x" } }, { thread: "planner", model: "gpt" }, ["planner now uses openai/gpt-x"]],
    ["thread_set_reasoning", { kind: "ok", thread_id: PEER, level: "high", scope: "turn" }, { thread: "self", level: "high" }, ["this thread reasoning: high for this turn"]],
    ["thread_report", { kind: "ok", binding_id: "bnd-7", revision: 1, event: "question", cursor: 5, reply_token: "tok", armed: false, deduplicated: false }, { kind: "question", text: "?" }, ["question sent; waiting for a reply"]],
    ["thread_report", { kind: "ok", binding_id: "bnd-7", revision: 1, event: "completion", cursor: null, reply_token: null, armed: true, deduplicated: false }, { kind: "completion", text: "done" }, ["completion armed; sent when this run settles"]],
    ["thread_outbox_ack", { kind: "ok", binding_id: "bnd-7", acked_cursor: 12, changed: true }, { binding_id: "bnd-7", cursor: 12 }, ["acked through #12"]],
    ["thread_outbox_ack", { kind: "ok", binding_id: "bnd-7", acked_cursor: 12, changed: false }, { binding_id: "bnd-7", cursor: 9 }, ["already acked through #12"]],
    ["thread_answer", { kind: "ok", binding_id: "bnd-7", cursor: 5, session_durable_id: PEER }, { binding_id: "bnd-7", reply_token: "tok", answer: "yes" }, ["answer delivered to the waiting question"]],
  ] as const)("#given a %s result #when it renders #then one outcome line", (name, value, args, expected) => {
    expect(result(name, value as ThreadToolResult, args)).toEqual([...expected])
  })

  const binding = (over: Record<string, unknown> = {}) => ({ schema_version: 1, binding_id: "bnd-7", revision: 2, status: "active", platform: "discord", account_id: "bot", chat_id: "c-42", thread_id: "@chat", root_message_id: null, progress_message_id: null, session_realm_id: "r", session_durable_id: PEER, direction: { inbound: true, outbound: true }, inbound_mode: "auto", outbound_events: [], policy_id: "default", created_at: "t", updated_at: "t", lease_started_at: "t", ttl_seconds: null, expires_at: null, ...over })

  test("#given relay binding results #when they render #then they name the chat, never the binding uuid", () => {
    expect(result("thread_bind", { kind: "ok", binding: binding(), deduplicated: false } as ThreadToolResult)).toEqual(["bound discord chat c-42 (inbound and outbound)"])
    expect(result("thread_unbind", { kind: "ok", binding: binding({ status: "detached" }), already_closed: false, in_flight: ["d1", "d2"], deduplicated: false } as ThreadToolResult)).toEqual(["unbound discord chat c-42", "  2 deliveries still in flight"])
    expect(result("thread_rebind", { kind: "ok", binding: binding({ revision: 3 }), closed: ["d1"], deduplicated: false } as ThreadToolResult)).toEqual(["moved discord chat c-42 to 01a1c470", "  1 queued delivery closed"])
    expect(result("thread_bindings", { kind: "ok", bindings: [binding(), binding({ chat_id: "c-9", status: "expired", platform: "slack" })], next_cursor: "n" } as ThreadToolResult)).toEqual([
      "2 bindings",
      "  discord c-42  active",
      "  slack c-9  expired",
      "  more on the next page",
    ])
  })

  test("#given outbox rows #when thread_outbox renders #then it counts pending rows and shows the newest heads", () => {
    const row = (cursor: number, event: string, text: string, state: string) => ({ cursor, binding_id: "bnd-7", revision: 2, event, text, state, created_at: "t", edit_message_id: null, provider_message_id: null, reply_token: null, question_state: null, outcome: null, answered_by: null, answer_state: null })
    const outbox = { kind: "ok", binding_id: "bnd-7", revision: 2, status: "active", rows: [row(3, "milestone", "50% done\nmore", "acked"), row(4, "question", "ship it?", "pending")], next_cursor: 4, acked_cursor: 3 } as ThreadToolResult
    expect(result("thread_outbox", outbox, { binding_id: "bnd-7" })).toEqual(["2 outbox rows, 1 pending", "  #3 milestone: 50% done", "  #4 question: ship it?"])
  })

  test("#given a result the details do not carry #when it renders #then the content text is parsed instead", () => {
    const value = { kind: "ok", thread_id: PEER, closed: true } as ThreadToolResult
    const lines = trimmed(renderThreadResult("thread_close")({ content: [{ type: "text", text: JSON.stringify(value) }], details: undefined } as never, { expanded: false, isPartial: false }, PLAIN, { args: { thread: "planner" }, isError: false } as never).render(WIDE))
    expect(lines).toEqual(["closed planner"])
  })
})
