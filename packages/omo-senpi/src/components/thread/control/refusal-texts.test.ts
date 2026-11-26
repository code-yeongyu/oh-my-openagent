import { describe, expect, test } from "bun:test"

import { guidance, type GuidanceId, provenanceOf, REFUSAL_TEXTS, refusal, type RefusalId } from "../refusal-texts"
import { CONTROL_TEXTS } from "./refusal-texts"

// Goldens for the control.* templates (#14951): each expected message and next_action is the sentence its call site built
// by hand before the migration, copied from that code with the slot values substituted, so a template that drifts by one
// byte from what the thread tools answered fails here.
type Golden = {
  readonly id: RefusalId
  readonly slots: Readonly<Record<string, string>>
  readonly message: string
  readonly next: string
}

const UPDATE_HERE = "Update omo on this device and restart its host."
const UNREACHABLE_NEXT =
  "Start omo on that device (an omo session, or omo daemon run), or create the thread on another device."
const PICK_EXACT =
  "Call thread_list (tool.thread_list() in an eval cell) and pass the exact thread value of the intended thread."
const OUT_OF_SCOPE_NEXT =
  "Call thread_list with all_scope (tool.thread_list({ all_scope: true }) in an eval cell) to see it, then retry with all_scope set, or target a thread in this workspace."

const GOLDENS: readonly Golden[] = [
  {
    id: "control.close_working_unnamed",
    slots: { thread: "dur-1", state: "turn_active: bash" },
    message:
      "Thread dur-1 is still working (turn_active: bash), and its host's engine cannot name the messages a forced close would drop.",
    next: "Wait for it to read them, or close it with force: true (anything it has not read is dropped); an engine that names them comes with a newer senpi on that device.",
  },
  {
    id: "control.close_unread_unnamed",
    slots: { thread: "dur-1", state: "work_pending" },
    message: "Thread dur-1 holds messages it has not read (work_pending), and its host's engine cannot name them.",
    next: "Wait for it to read them, or close it with force: true (anything it has not read is dropped); an engine that names them comes with a newer senpi on that device.",
  },
  {
    id: "control.close_unread",
    slots: { thread: "dur-1", count: "2", deliveries: "d-1, d-2" },
    message: "Thread dur-1 has 2 message(s) it has not read yet (d-1, d-2); closing it now would drop them.",
    next: "Let it read them and retry, or close it with force: true to drop them (the result lists dropped_deliveries).",
  },
  {
    id: "control.close_not_graceful",
    slots: { thread: "dur-1" },
    message: "The engine holding thread dur-1 cannot close it gracefully: it runs a senpi from before graceful close.",
    next: "Update omo on that device and restart its host, or close the thread with force: true (its running turn is stopped).",
  },
  {
    id: "control.close_no_time",
    slots: { thread: "dur-1" },
    message: "This call has no time left to wait for thread dur-1's turn.",
    next: "Close it again in a new call.",
  },
  {
    id: "control.close_still_working",
    slots: { thread: "dur-1", turn: "4", waited_ms: "500", returned: "1" },
    message:
      "Thread dur-1 is still working on turn 4 after 500 ms. It stays open and takes messages again; the 1 unread message(s) taken out of its queue are queued for it again.",
    next: "Close it again with a longer wait_ms once its turn is nearly done, or with force: true to stop the turn.",
  },
  {
    id: "control.close_still_working_capped",
    slots: { thread: "dur-1", turn: "4", waited_ms: "500", requested_ms: "9000", returned: "0" },
    message:
      "Thread dur-1 is still working on turn 4 after 500 ms (the most a thread on another device can wait, not the 9000 ms asked for). It stays open and takes messages again; the 0 unread message(s) taken out of its queue are queued for it again.",
    next: "Close it again once its turn is nearly done, or with force: true to stop the turn.",
  },
  {
    id: "control.close_composer_draft",
    slots: { thread: "dur-1" },
    message: "Thread dur-1's terminal has unsent text in its composer, and a close would discard it.",
    next: "Ask the person at that terminal to send or clear it, then close the thread again.",
  },
  {
    id: "control.close_host_draining",
    slots: { thread: "dur-1" },
    message: "The host holding thread dur-1 is shutting down and refused to close it.",
    next: "Retry once that host has restarted.",
  },
  {
    id: "control.close_refused",
    slots: { thread: "dur-1", reason: "bash_running" },
    message: "The host holding thread dur-1 refused to close it (bash_running).",
    next: "Read the thread and retry once its work settles.",
  },
  {
    id: "control.close_refused_detail",
    slots: { thread: "dur-1", reason: "bash_running", detail: "sleep 9" },
    message: "The host holding thread dur-1 refused to close it (bash_running: sleep 9).",
    next: "Read the thread and retry once its work settles.",
  },
  {
    id: "control.close_terminal_graceful_only",
    slots: { thread: "dur-1" },
    message: "Thread dur-1 belongs to an interactive terminal, which closes only gracefully.",
    next: "Close it with graceful: true (the terminal exits once its turn ends), or use thread_interrupt (tool.thread_interrupt() in an eval cell) to stop its turn.",
  },
  {
    id: "control.close_not_accepted",
    slots: { thread: "dur-1" },
    message: "The host holding thread dur-1 does not accept close requests.",
    next: UPDATE_HERE,
  },
  {
    id: "control.unload_unsupported",
    slots: { thread: "dur-1" },
    message: "The engine holding thread dur-1 does not take unload_session: it runs a senpi from before unload.",
    next: "Update omo on the device holding it and restart its host, or close the thread instead.",
  },
  {
    id: "control.unload_not_held",
    slots: { thread: "dur-on-b", reason: "unknown_session" },
    message: "No engine holds thread dur-on-b now: its host answered unknown_session.",
    next: "List the threads again (threads.list) and unload the thread by the address it lists.",
  },
  {
    id: "control.unload_working",
    slots: { thread: "dur-1", state: "turn_active: an agent run" },
    message: "Thread dur-1 is still working (turn_active: an agent run), so it was not unloaded.",
    next: "Wait for its turn to end, or unload it with interrupt: true to stop the turn first.",
  },
  {
    id: "control.unload_children",
    slots: { thread: "dur-1", state: "children_live: child tasks still working" },
    message:
      "Thread dur-1 has child tasks or sessions still working (children_live: child tasks still working), so it was not unloaded.",
    next: 'Wait for them to finish, or unload it with children: "detach" to leave them running.',
  },
  {
    id: "control.unload_extension_work",
    slots: { thread: "dur-1", state: "extension_work: work published by monitor" },
    message:
      "Thread dur-1 runs work its extensions published (extension_work: work published by monitor), which an unload stops for good, so it was not unloaded.",
    next: "Let that work finish, or unload it with force: true to stop it.",
  },
  {
    id: "control.unload_attached",
    slots: { thread: "dur-1", state: "attached: 1 other client(s) attached" },
    message: "Other clients hold thread dur-1 (attached: 1 other client(s) attached), so it was not unloaded.",
    next: "Ask them to detach, or unload it with force: true (they see the session parked).",
  },
  {
    id: "control.unload_host_draining",
    slots: { thread: "dur-1" },
    message: "The host holding thread dur-1 is shutting down and refused to unload it.",
    next: "Retry once that host has restarted.",
  },
  {
    id: "control.unload_refused",
    slots: { thread: "dur-1", state: "unsupported: the session has no file to reopen it by" },
    message:
      "The host holding thread dur-1 refused to unload it (unsupported: the session has no file to reopen it by).",
    next: "Read the thread and retry once its work settles.",
  },
  {
    id: "control.wait_unsupported",
    slots: { thread: "dur-1" },
    message: "The host holding thread dur-1 cannot report when its turn ends.",
    next: UPDATE_HERE,
  },
  {
    id: "control.status_refused",
    slots: { thread: "dur-1", reason: "closed" },
    message: "The endpoint holding thread dur-1 refused to report its status (closed).",
    next: UPDATE_HERE,
  },
  {
    id: "control.archive_unsupported",
    slots: { thread: "dur-1" },
    message:
      "The engine holding thread dur-1 does not know set_session_archived: it runs a senpi from before archived threads.",
    next: "Update omo on this device and restart the session's host or terminal, then retry.",
  },
  {
    id: "control.close_held_elsewhere",
    slots: { thread: "dur-1" },
    message:
      "Thread dur-1 has no session file yet and another client still holds it, so only this tool's hold was released.",
    next: "Close it from the client that holds it, or send it a message first so it can be closed for every holder.",
  },
  {
    id: "control.thinking_level_unsupported",
    slots: { level: "low" },
    message: 'Thinking level "low" is not supported by the active model.',
    next: "Choose a level from the supported list and retry.",
  },
  {
    id: "control.thinking_level_unsupported_on_device",
    slots: { level: "low" },
    message: "Thinking level low is not supported by the active model.",
    next: "Choose a level from the supported list and retry.",
  },
  {
    id: "control.thread_opening",
    slots: { thread: "dur-1" },
    message: "Thread dur-1 is opening on its host and cannot accept controls yet.",
    next: "Retry once the thread is open.",
  },
  {
    id: "control.rename_conflict",
    slots: { name: "peer" },
    message: 'A thread named "peer" already exists.',
    next: "Call thread_list (tool.thread_list() in an eval cell) and choose another name.",
  },
  {
    id: "control.receipt_recovery_full",
    slots: { max_keys: "4096" },
    message:
      "4096 earlier calls on this surface failed before the gateway store answered and may still need recovering; nothing ran.",
    next: "Retry those calls under their own idempotency keys, then retry this one.",
  },
  {
    id: "control.launch_fields_for_new",
    slots: { fields: "model, reasoning" },
    message: "model, reasoning apply to a new thread; thread opens an existing one as it is.",
    next: "Drop them to open the thread, or drop thread to create a new one with them.",
  },
  {
    id: "control.launch_model_shape",
    slots: { model: '"gpt"' },
    message: 'model "gpt" is not a provider/id.',
    next: "Pass the exact provider/id the device lists (thread_set_model, tool.thread_set_model() in an eval cell, shows them).",
  },
  {
    id: "control.launch_preset_wider",
    slots: { creator: "an unknown approval mode", requested: "yolo" },
    message:
      "This session runs in an unknown approval mode; a thread it creates cannot run in yolo, which allows more.",
    next: "Pass this session's own mode or a narrower one (ask is always allowed), or leave permission_preset unset.",
  },
  {
    id: "control.create_skill_names",
    slots: { names: "../x, y z" },
    message: "Not a skill name: ../x, y z. Pass the names of installed skills, never a path or text.",
    next: "Pass skill names as listed by the skill index.",
  },
  {
    id: "control.create_prompt_not_started",
    slots: { thread: "dur-1", where: " on device b", state: "queued", waiting: ", waiting on its approval" },
    message:
      "Thread dur-1 was created on device b, but its first prompt did not start a turn (its delivery is queued, waiting on its approval).",
    next: "The thread exists: read it with thread_read (tool.thread_read({ thread }) in an eval cell) to see whether the prompt ran, then send the prompt again with thread_send to dur-1 (tool.thread_send({ thread, message }) in an eval cell) if it did not. Do not create the thread again.",
  },
  {
    id: "control.create_prompt_undelivered",
    slots: { thread: "dur-1", error: "socket closed" },
    message: "The thread was created, but its first prompt was not delivered: socket closed.",
    next: "Send it with thread_send to dur-1 (tool.thread_send({ thread, message }) in an eval cell); read the thread first if the prompt may have arrived.",
  },
  {
    id: "control.create_prompt_schema_too_new",
    slots: { thread: "dur-1", supported: "16", found: "17" },
    message:
      "The thread was created, but its first prompt was not delivered: this omo build reads gateway schema 16, while this machine's gateway store is at schema 17: a newer omo build already upgraded it.",
    next: "Update omo with `omo update`, then send the prompt with thread_send to dur-1 (tool.thread_send({ thread, message }) in an eval cell).",
  },
  {
    id: "control.open_model_unavailable",
    slots: { where: "device b", model: "a/b" },
    message: "No thread was created: device b cannot run a/b.",
    next: "Pass a provider/id device b has (thread_set_model, tool.thread_set_model() in an eval cell, lists them), or leave model unset for its default.",
  },
  {
    id: "control.open_fork_not_local",
    slots: { source: "dur-src", where: "this device" },
    message: "No thread was created: dur-src is not a session this device holds, so its engine cannot fork it.",
    next: "A fork is made on the device that holds its source: call thread_list with all_scope (tool.thread_list({ all_scope: true }) in an eval cell) to find that device, and fork the thread by the id listed there.",
  },
  {
    id: "control.open_fork_not_found",
    slots: { source: "dur-src", where: "device b" },
    message: "No thread was created: device b has no readable session file for dur-src to fork.",
    next: "Call thread_list with all_scope (tool.thread_list({ all_scope: true }) in an eval cell) and fork a thread it lists.",
  },
  {
    id: "control.relay_made_unowned",
    slots: { device: "b", thread: "dur-1", reason: "route_unlisted" },
    message:
      "Device b made thread dur-1, but its route does not reach it (route_unlisted), and its open named no routing id to end it by: it is left with no live owner.",
    next: UNREACHABLE_NEXT,
  },
  {
    id: "control.relay_made_unowned_worktree",
    slots: { device: "b", thread: "dur-1", reason: "route_unlisted", worktree: "/w/wt" },
    message:
      "Device b made thread dur-1, but its route does not reach it (route_unlisted), and its open named no routing id to end it by: it is left with no live owner. The worktree /w/wt made for it is still on that device.",
    next: UNREACHABLE_NEXT,
  },
  {
    id: "control.relay_made_end_failed",
    slots: { device: "b", thread: "dur-1", reason: "route_unlisted" },
    message:
      "Device b made thread dur-1, but its route does not reach it (route_unlisted), and ending it there failed: it is left with no live owner.",
    next: UNREACHABLE_NEXT,
  },
  {
    id: "control.relay_made_end_failed_worktree",
    slots: { device: "b", thread: "dur-1", reason: "route_unlisted", worktree: "/w/wt" },
    message:
      "Device b made thread dur-1, but its route does not reach it (route_unlisted), and ending it there failed: it is left with no live owner. The worktree /w/wt made for it is still on that device.",
    next: UNREACHABLE_NEXT,
  },
  {
    id: "control.relay_open_unreachable",
    slots: { device: "b", reason: "route_unlisted" },
    message:
      "Device b took the open, but its route does not reach the session it made (route_unlisted): no thread host there that this account reaches takes new threads. Nothing was left behind.",
    next: UNREACHABLE_NEXT,
  },
  {
    id: "control.relay_open_unreachable_worktree",
    slots: { device: "b", reason: "route_unlisted", worktree: "/w/wt" },
    message:
      "Device b took the open, but its route does not reach the session it made (route_unlisted): no thread host there that this account reaches takes new threads. The worktree /w/wt made for it is still on that device.",
    next: UNREACHABLE_NEXT,
  },
  {
    id: "control.relay_reopen_unreachable",
    slots: { device: "b", reason: "not_found" },
    message: "Device b opened the thread's file, but the reopened session cannot be reached there (not_found).",
    next: "Call thread_list with all_scope (tool.thread_list({ all_scope: true }) in an eval cell), then open the thread by the id it lists.",
  },
  {
    id: "control.relay_open_unnamed",
    slots: { device: "b" },
    message: "Device b opened a session but did not name it.",
    next: "Call thread_list with all_scope (tool.thread_list({ all_scope: true }) in an eval cell) to find the new thread.",
  },
  {
    id: "control.relay_key_unnamed",
    slots: { device: "b", reason: "session_not_found" },
    message: "Device b created the thread but did not name its relay key (session_not_found).",
    next: "Address it by its thread value once thread_list with all_scope (tool.thread_list({ all_scope: true }) in an eval cell) lists it, or update omo on that device.",
  },
  {
    id: "control.relay_no_device",
    slots: { device: "studio" },
    message: "No device named studio is signed in to this account.",
    next: "Call thread_list with all_scope (tool.thread_list({ all_scope: true }) in an eval cell) to see the account's devices and threads.",
  },
  {
    id: "control.reply_sender_ambiguous",
    slots: { address: "planner" },
    message: '"planner" names more than one sender of this run\'s deliveries; none was picked.',
    next: "Send to the intended thread as a normal send, by its id.",
  },
  {
    id: "control.address_not_string",
    slots: { what: "thread address" },
    message: "The thread address must be a string.",
    next: "Pass a thread value or a unique name from thread_list (tool.thread_list() in an eval cell) as the thread address.",
  },
  {
    id: "control.address_control_characters",
    slots: { what: "fuzzy query" },
    message: "The fuzzy query contains control characters.",
    next: "Remove the control characters and retry, or pass an address from thread_list (tool.thread_list() in an eval cell).",
  },
  {
    id: "control.address_empty",
    slots: { what: "thread name" },
    message: "The thread name is empty.",
    next: "Pass a thread value or a unique name from thread_list (tool.thread_list() in an eval cell) as the thread name.",
  },
  {
    id: "control.address_outside_workspace",
    slots: { thread: "dur-1" },
    message: "Thread dur-1 exists outside this workspace.",
    next: "Call thread_list with all_scope (tool.thread_list({ all_scope: true }) in an eval cell) to confirm the id, then retry with all_scope set, or target a thread in this workspace.",
  },
  {
    id: "control.address_not_found",
    slots: { target: "ghost", scope: "this workspace" },
    message: 'No visible thread matches "ghost" in this workspace.',
    next: "Call thread_list (tool.thread_list() in an eval cell) and pass a row's thread value or a unique name it returned.",
  },
  {
    id: "control.address_not_found_id",
    slots: { target: "0123", scope: "the daemon-wide scope" },
    message:
      'No visible thread matches "0123" in the daemon-wide scope. No reachable endpoint lists a thread with that thread_id.',
    next: "Call thread_list with all_scope (tool.thread_list({ all_scope: true }) in an eval cell) to check the id; a thread on a device that is offline is found once it is online.",
  },
  {
    id: "control.address_not_found_session_id",
    slots: { target: "rpc-9", scope: "this workspace" },
    message:
      'No visible thread matches "rpc-9" in this workspace. "rpc-9" is a session id, not a thread value. Pass the thread value thread_list (tool.thread_list() in an eval cell) shows, or omit thread / pass self for this session.',
    next: "Call thread_list (tool.thread_list() in an eval cell) and pass a row's thread value.",
  },
  {
    id: "control.address_not_found_session_id_listed",
    slots: { target: "rpc-9", scope: "this workspace", threads: "t-1, t-2" },
    message:
      'No visible thread matches "rpc-9" in this workspace. "rpc-9" is a session id, not a thread value. Pass the thread value thread_list (tool.thread_list() in an eval cell) shows, or omit thread / pass self for this session. Visible thread values: t-1, t-2.',
    next: "Call thread_list (tool.thread_list() in an eval cell) and pass a row's thread value.",
  },
  {
    id: "control.address_session_id_outside_workspace",
    slots: { thread: "t-out", target: "rpc-3" },
    message: 'Thread t-out (session id "rpc-3") exists outside this workspace.',
    next: "Call thread_list with all_scope (tool.thread_list({ all_scope: true }) in an eval cell) and pass thread t-out, or target a thread in this workspace.",
  },
  {
    id: "control.address_session_id_ambiguous",
    slots: { count: "2", target: "rpc-1", threads: "t-1, t-2" },
    message: '2 visible threads share the session id "rpc-1". Pass one thread: t-1, t-2.',
    next: PICK_EXACT,
  },
  {
    id: "control.address_name_ambiguous",
    slots: { count: "2", target: "twin" },
    message: '2 visible threads share the name "twin".',
    next: PICK_EXACT,
  },
  {
    id: "control.address_prefix_ambiguous",
    slots: { count: "3", target: "0123abcd" },
    message: '3 threads have an id starting with "0123abcd".',
    next: "Pass a longer prefix or the exact thread value from the candidates.",
  },
  {
    id: "control.address_name_outside_workspace",
    slots: { target: "ghost lane" },
    message: 'A thread named "ghost lane" exists on this device outside this workspace.',
    next: OUT_OF_SCOPE_NEXT,
  },
  {
    id: "control.address_names_outside_workspace",
    slots: { count: "2", target: "ghost lane" },
    message: '2 threads named "ghost lane" exist on this device outside this workspace.',
    next: OUT_OF_SCOPE_NEXT,
  },
  {
    id: "control.address_fuzzy_too_short",
    slots: { min: "3", query: "ab" },
    message: 'A fuzzy query needs at least 3 characters; "ab" is too short.',
    next: "Pass a longer query, or call thread_list (tool.thread_list() in an eval cell) and pass a row's thread value or a unique name it returned.",
  },
  {
    id: "control.address_fuzzy_capped",
    slots: { count: "501", cap: "500" },
    message: "501 threads are in scope; the fuzzy scan is capped at 500.",
    next: "Call thread_list (tool.thread_list() in an eval cell), pick the intended thread, and pass its thread value instead of a fuzzy query.",
  },
  {
    id: "control.address_fuzzy_no_match",
    slots: { query: "payments", best: "0.412" },
    message: 'No thread scored close enough to "payments" (best 0.412).',
    next: "Call thread_list (tool.thread_list() in an eval cell) and pass a row's thread value, or retry with a longer, more distinctive query.",
  },
  {
    id: "control.address_fuzzy_ambiguous",
    slots: { query: "payments", best: "0.800", runner_up: "0.760" },
    message: 'Several threads match "payments" about equally (best 0.800, runner-up 0.760).',
    next: PICK_EXACT,
  },
  {
    id: "control.address_name_conflict",
    slots: { name: "peer", thread: "dur-peer" },
    message: 'A thread named "peer" (dur-peer) already exists.',
    next: "Call thread_list (tool.thread_list() in an eval cell) to reuse that thread by id, or pass a different name for the new thread.",
  },
]

const GUIDANCE_GOLDENS: readonly {
  readonly id: GuidanceId
  readonly slots: Readonly<Record<string, string>>
  readonly text: string
}[] = [
  {
    id: "control.create_prompt_queued_next",
    slots: { thread: "dur-1" },
    text: "The prompt is stored and runs when dur-1 wakes: do not send it again. Check it with thread_read (tool.thread_read({ thread }) in an eval cell).",
  },
  {
    id: "control.create_prompt_queued_next_on_device",
    slots: { thread: "dur-on-b", device: "b" },
    text: "The prompt is stored on device b and runs when dur-on-b wakes: do not send it again. Check it with thread_read (tool.thread_read({ thread }) in an eval cell).",
  },
]

describe("the control refusal templates (#14951)", () => {
  test.each(GUIDANCE_GOLDENS.map((golden) => [golden.id, golden] as const))(
    "#given %s and its slots #when guidance() renders it #then it is the hand-built sentence, byte for byte",
    (_id, golden) => {
      expect(guidance(golden.id, golden.slots)).toBe(golden.text)
    },
  )

  test.each(GOLDENS.map((golden) => [golden.id, golden] as const))(
    "#given %s and its slots #when refusal() renders it #then the message and next_action are the hand-built sentence, byte for byte",
    (_id, golden) => {
      const rendered = refusal(golden.id, golden.slots)
      expect(rendered.code).toBe(REFUSAL_TEXTS[golden.id].code)
      expect(rendered.message).toBe(golden.message)
      expect(rendered.next_action).toBe(golden.next)
      expect(provenanceOf(rendered)).toEqual({ id: golden.id, slots: golden.slots })
    },
  )

  test("#given every control template #when the goldens are counted #then each has one", () => {
    const covered: string[] = [...GOLDENS, ...GUIDANCE_GOLDENS].map((golden) => golden.id)
    expect(covered.sort()).toEqual(Object.keys(CONTROL_TEXTS).sort())
  })

  test("#given a slot value that looks like a template #when it is rendered #then it is inserted as it is, never filled again", () => {
    const thread = "{thread} {{x}} {level}"
    const rendered = refusal("control.close_no_time", { thread })
    expect(rendered.message).toBe(`This call has no time left to wait for thread ${thread}'s turn.`)
    expect(provenanceOf(rendered)?.slots).toEqual({ thread })
  })
})
