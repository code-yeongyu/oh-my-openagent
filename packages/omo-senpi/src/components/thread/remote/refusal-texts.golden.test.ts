import { describe, expect, test } from "bun:test"
import { provenanceOf, refusal, type RefusalId } from "../refusal-texts"
import { RELAY_TEXTS } from "./refusal-texts"

// The relay transport's refusal sentences as dev words them (captured from relay-transport.ts at 15bafa3d66, before they
// moved onto the one registry): a refactor, so every code and variant must stay byte-equal. A response protocol contract
// the three surfaces print; a wording change is a recorded behaviour change, never an edit of this table.
type Sentence = { readonly code: string; readonly message: string; readonly next_action: string }
const GOLDEN: Record<
  string,
  { readonly id: RefusalId; readonly slots: Readonly<Record<string, string>>; readonly want: Sentence }
> = {
  state_read_unanswered: {
    id: "relay.state_read_unanswered",
    slots: { device: "dev-b", reason: "x-reason" },
    want: {
      code: "host_unavailable",
      message: "Device dev-b did not answer the state read (x-reason); nothing was sent there.",
      next_action: "Retry; nothing needs to be checked first.",
    },
  },
  wake_session_gone: {
    id: "relay.wake_session_gone",
    slots: { device: "dev-b" },
    want: {
      code: "not_found",
      message: "Device dev-b holds no session file for that id.",
      next_action: "Call thread_list with all_scope (tool.thread_list({ all_scope: true }) in an eval cell).",
    },
  },
  wake_ambiguous_session: {
    id: "relay.wake_ambiguous_session",
    slots: { device: "dev-b" },
    want: {
      code: "ambiguous_target",
      message: "Device dev-b holds more than one session file with that id; none was picked.",
      next_action: "Address another thread, or resolve the duplicate on that device.",
    },
  },
  wake_not_wakeable: {
    id: "relay.wake_not_wakeable",
    slots: { device: "dev-b", reason: "not_wakeable" },
    want: {
      code: "not_resumable",
      message: "Device dev-b cannot wake that session (not_wakeable).",
      next_action: "Address another thread.",
    },
  },
  wake_sender_not_admitted: {
    id: "relay.wake_not_wakeable",
    slots: { device: "dev-b", reason: "sender_not_admitted" },
    want: {
      code: "not_resumable",
      message: "Device dev-b cannot wake that session (sender_not_admitted).",
      next_action: "Address another thread.",
    },
  },
  wake_queue_full: {
    id: "relay.wake_queue_full",
    slots: { device: "dev-b" },
    want: {
      code: "queue_full",
      message: "The session on device dev-b has a full backlog.",
      next_action: "Retry later.",
    },
  },
  wake_overloaded: {
    id: "relay.wake_overloaded",
    slots: { device: "dev-b" },
    want: {
      code: "overloaded",
      message: "Device dev-b is waking too many sessions now.",
      next_action: "Retry after the given delay.",
    },
  },
  wake_pair_loop_guard: {
    id: "relay.wake_pair_loop_guard",
    slots: {
      guard: "3 sends from this device to the session on device dev-b within 10 s; this one was not delivered.",
      guard_next:
        "This looks like a send loop between these two sessions; the next send to this target is accepted after 3 s.",
    },
    want: {
      code: "pair_loop_guard",
      message: "3 sends from this device to the session on device dev-b within 10 s; this one was not delivered.",
      next_action:
        "This looks like a send loop between these two sessions; the next send to this target is accepted after 3 s.",
    },
  },
  wake_pair_loop_guard_no_retry: {
    id: "relay.wake_pair_loop_guard_no_retry",
    slots: {
      guard: "3 sends from this device to the session on device dev-b within 10 s; this one was not delivered.",
    },
    want: {
      code: "pair_loop_guard",
      message: "3 sends from this device to the session on device dev-b within 10 s; this one was not delivered.",
      next_action: "This looks like a send loop between these two sessions; wait before sending to that session again.",
    },
  },
  wake_pair_loop_guard_no_window: {
    id: "relay.wake_pair_loop_guard_no_window",
    slots: {
      device: "dev-b",
      guard_next:
        "This looks like a send loop between these two sessions; the next send to this target is accepted after 3 s.",
    },
    want: {
      code: "pair_loop_guard",
      message: "Device dev-b held this send back: this device sent that session its whole burst; it was not delivered.",
      next_action:
        "This looks like a send loop between these two sessions; the next send to this target is accepted after 3 s.",
    },
  },
  wake_pair_loop_guard_bare: {
    id: "relay.wake_pair_loop_guard_bare",
    slots: { device: "dev-b" },
    want: {
      code: "pair_loop_guard",
      message: "Device dev-b held this send back: this device sent that session its whole burst; it was not delivered.",
      next_action: "This looks like a send loop between these two sessions; wait before sending to that session again.",
    },
  },
  wake_limit_reached: {
    id: "relay.wake_limit_reached",
    slots: { device: "dev-b" },
    want: {
      code: "overloaded",
      message: "The session on device dev-b reached its limit of unattended wakes; the message stays queued there.",
      next_action: "Wait for a person to use that session.",
    },
  },
  wake_no_process: {
    id: "relay.wake_no_process",
    slots: { device: "dev-b" },
    want: {
      code: "host_unavailable",
      message: "No omo process on device dev-b can take the message now.",
      next_action: "Start omo once on that device, then retry.",
    },
  },
  wake_unsupported: {
    id: "relay.wake_unsupported",
    slots: { device: "dev-b" },
    want: {
      code: "unsupported",
      message: "Device dev-b cannot wake a session that is not running.",
      next_action: "Update omo on that device.",
    },
  },
  wake_refused: {
    id: "relay.wake_refused",
    slots: { device: "dev-b", reason: "x-reason" },
    want: {
      code: "unsupported",
      message: "Device dev-b refused the message (x-reason).",
      next_action: "Address another thread.",
    },
  },
  wake_refused_unrecognised: {
    id: "relay.wake_refused_unrecognised",
    slots: { device: "dev-b" },
    want: {
      code: "unsupported",
      message: "Device dev-b refused the message (unrecognised reason).",
      next_action: "Address another thread.",
    },
  },
  held_steer_ended_turn_conflict: {
    id: "relay.held_steer_ended_turn_conflict",
    slots: { turn: "7", session: "sess-1", device: "dev-b" },
    want: {
      code: "turn_conflict",
      message:
        "Turn 7 of sess-1 on device dev-b ended while that session's open draft held the steer; it was not delivered.",
      next_action: "Read the target again and retry with its current turn id, or send with delivery auto.",
    },
  },
  held_steer_ended_turn_conflict_no_turn: {
    id: "relay.held_steer_ended_turn_conflict",
    slots: { turn: "?", session: "sess-1", device: "dev-b" },
    want: {
      code: "turn_conflict",
      message:
        "Turn ? of sess-1 on device dev-b ended while that session's open draft held the steer; it was not delivered.",
      next_action: "Read the target again and retry with its current turn id, or send with delivery auto.",
    },
  },
  held_steer_ended_not_steerable: {
    id: "relay.held_steer_ended_not_steerable",
    slots: { turn: "7", session: "sess-1", device: "dev-b" },
    want: {
      code: "not_steerable",
      message:
        "Turn 7 of sess-1 on device dev-b ended while that session's open draft held the steer; it was not delivered.",
      next_action: "Send with delivery auto or follow_up; a steer needs a running turn.",
    },
  },
  idempotency_conflict: {
    id: "relay.idempotency_conflict",
    slots: {},
    want: {
      code: "idempotency_conflict",
      message: "The idempotency key was already used with different arguments.",
      next_action: "Retry with a new idempotency_key.",
    },
  },
  idempotency_uncertain_noted: {
    id: "relay.idempotency_uncertain",
    slots: {},
    want: {
      code: "idempotency_uncertain",
      message: "The earlier operation may have been delivered.",
      next_action: "Read the target transcript before deciding whether to retry.",
    },
  },
  idempotency_in_progress: {
    id: "relay.idempotency_in_progress",
    slots: {},
    want: {
      code: "idempotency_in_progress",
      message: "The same operation is already in progress.",
      next_action: "Wait for the earlier call to settle, then retry.",
    },
  },
  idempotency_uncertain: {
    id: "relay.idempotency_uncertain",
    slots: {},
    want: {
      code: "idempotency_uncertain",
      message: "The earlier operation may have been delivered.",
      next_action: "Read the target transcript before deciding whether to retry.",
    },
  },
  no_session_file: {
    id: "relay.no_session_file",
    slots: { device: "dev-b", thread: "dur-1" },
    want: {
      code: "not_found",
      message: "Device dev-b holds no session file for dur-1.",
      next_action: "Call thread_list with all_scope (tool.thread_list({ all_scope: true }) in an eval cell).",
    },
  },
  no_running_owner: {
    id: "relay.no_running_owner",
    slots: { device: "dev-b", thread: "dur-1" },
    want: {
      code: "not_resumable",
      message: "No running owner for dur-1 on device dev-b.",
      next_action: "Open the thread on that device before sending.",
    },
  },
  reopen_no_row: {
    id: "relay.reopen_no_row",
    slots: { device: "dev-b", thread: "dur-1" },
    want: {
      code: "internal_error",
      message: "Reopening dur-1 on device dev-b answered no row.",
      next_action: "Retry the send.",
    },
  },
  running_key_unlocated: {
    id: "relay.running_key_unlocated",
    slots: { device: "dev-b", thread: "dur-1", reason: "x-reason" },
    want: {
      code: "not_resumable",
      message: "Device dev-b runs dur-1, but the key it runs under cannot be found there (x-reason).",
      next_action:
        "Call thread_list with all_scope (tool.thread_list({ all_scope: true }) in an eval cell), then send again.",
    },
  },
  steer_not_running: {
    id: "relay.steer_not_running",
    slots: { thread: "dur-1", device: "dev-b" },
    want: {
      code: "turn_conflict",
      message: "dur-1 on device dev-b is not running, so no turn of it can be steered.",
      next_action: "Read the target again and retry with its current turn id, or send with delivery auto.",
    },
  },
  steer_refused_turn_conflict: {
    id: "relay.steer_refused_turn_conflict",
    slots: { session: "sess-1", device: "dev-b" },
    want: {
      code: "turn_conflict",
      message: "A steer to sess-1 on device dev-b was refused: turn_conflict.",
      next_action: "Read the target again and retry with its current turn id, or send with delivery auto.",
    },
  },
  steer_refused_not_steerable: {
    id: "relay.steer_refused_not_steerable",
    slots: { session: "sess-1", device: "dev-b" },
    want: {
      code: "not_steerable",
      message: "A steer to sess-1 on device dev-b was refused: not_steerable.",
      next_action: "Send with delivery auto or follow_up; a steer needs a running turn.",
    },
  },
  steer_refused_not_steerable_answered: {
    id: "relay.steer_refused_not_steerable",
    slots: { session: "sess-1", device: "dev-b" },
    want: {
      code: "not_steerable",
      message: "A steer to sess-1 on device dev-b was refused: not_steerable.",
      next_action: "Send with delivery auto or follow_up; a steer needs a running turn.",
    },
  },
  admit_unsupported: {
    id: "relay.admit_unsupported",
    slots: { device: "dev-b", reason: "x-reason" },
    want: {
      code: "unsupported",
      message:
        "Device dev-b runs an engine without admit_external_message (x-reason); a peer message cannot be delivered there as a delivery.",
      next_action: "Update omo and senpi on that device, then retry.",
    },
  },
  steer_turn_ended: {
    id: "relay.steer_turn_ended",
    slots: { turn: "7", session: "sess-1", device: "dev-b" },
    want: {
      code: "turn_conflict",
      message: "Turn 7 is no longer the running turn of sess-1 on device dev-b.",
      next_action: "Read the target again and retry with its current turn id, or send with delivery auto.",
    },
  },
  steer_turn_ended_no_turn: {
    id: "relay.steer_turn_ended",
    slots: { turn: "?", session: "sess-1", device: "dev-b" },
    want: {
      code: "turn_conflict",
      message: "Turn ? is no longer the running turn of sess-1 on device dev-b.",
      next_action: "Read the target again and retry with its current turn id, or send with delivery auto.",
    },
  },
  unknown_admission: {
    id: "relay.unknown_admission",
    slots: { device: "dev-b", kind: "mystery" },
    want: {
      code: "idempotency_uncertain",
      message: "Device dev-b accepted the message but answered an unknown admission (mystery).",
      next_action: "Read the thread before deciding whether to send again.",
    },
  },
  wake_delivery_uncertain: {
    id: "relay.wake_delivery_uncertain",
    slots: { delivery: "del-1", device: "dev-b", reason: "x-reason" },
    want: {
      code: "idempotency_uncertain",
      message: "Delivery del-1 to device dev-b may still be delivered when that device wakes the session (x-reason).",
      next_action: "Retry with the same idempotency_key; a repeat of this delivery is never delivered twice.",
    },
  },
  wake_unknown_admission: {
    id: "relay.wake_unknown_admission",
    slots: { device: "dev-b", kind: "mystery" },
    want: {
      code: "idempotency_uncertain",
      message: "Device dev-b accepted the message but answered an unknown admission (mystery).",
      next_action: "Retry with the same idempotency_key; a repeat of this delivery is never delivered twice.",
    },
  },
  prompt_steer_refused_not_steerable: {
    id: "relay.prompt_steer_refused_not_steerable",
    slots: { session: "sess-1" },
    want: {
      code: "not_steerable",
      message: "A steer to sess-1 was refused: not_steerable.",
      next_action: "Send with delivery auto or follow_up; a steer needs a running turn.",
    },
  },
  prompt_steer_refused_not_steerable_answered: {
    id: "relay.prompt_steer_refused_not_steerable",
    slots: { session: "sess-1" },
    want: {
      code: "not_steerable",
      message: "A steer to sess-1 was refused: not_steerable.",
      next_action: "Send with delivery auto or follow_up; a steer needs a running turn.",
    },
  },
  prompt_steer_refused_turn_conflict: {
    id: "relay.prompt_steer_refused_turn_conflict",
    slots: { session: "sess-1" },
    want: {
      code: "turn_conflict",
      message: "A steer to sess-1 was refused: turn_conflict.",
      next_action: "Read the target again and retry with its current turn id, or send with delivery auto.",
    },
  },
  prompt_turn_unconfirmed: {
    id: "relay.prompt_turn_unconfirmed",
    slots: { turn: "7", session: "sess-1", device: "dev-b" },
    want: {
      code: "turn_conflict",
      message: "Turn 7 of sess-1 cannot be confirmed on device dev-b.",
      next_action: "Read the target again and retry with its current turn id, or send with delivery auto.",
    },
  },
  prompt_turn_unconfirmed_running: {
    id: "relay.prompt_turn_unconfirmed",
    slots: { turn: "(running)", session: "sess-1", device: "dev-b" },
    want: {
      code: "turn_conflict",
      message: "Turn (running) of sess-1 cannot be confirmed on device dev-b.",
      next_action: "Read the target again and retry with its current turn id, or send with delivery auto.",
    },
  },
  prompt_turn_mismatch: {
    id: "relay.prompt_turn_mismatch",
    slots: { turn: "7", session: "sess-1", device: "dev-b" },
    want: {
      code: "turn_conflict",
      message: "Turn 7 is not the running turn of sess-1 on device dev-b.",
      next_action: "Read the target again and retry with its current turn id, or send with delivery auto.",
    },
  },
  prompt_wait_unreported: {
    id: "relay.prompt_wait_unreported",
    slots: { device: "dev-b" },
    want: {
      code: "idempotency_uncertain",
      message: "Device dev-b accepted the message but did not report where it waits.",
      next_action: "Read the thread before deciding whether to send again.",
    },
  },
  cli_sender: {
    id: "relay.cli_sender",
    slots: { device: "dev-b", session: "sess-1" },
    want: {
      code: "unsupported",
      message:
        "A command-line sender cannot reach a session on device dev-b: the engine admits a command-line delivery only from its own machine.",
      next_action: "Use omo remote send dev-b/sess-1 instead.",
    },
  },
  turn_not_a_turn: {
    id: "relay.turn_not_a_turn",
    slots: { turn: "x7" },
    want: {
      code: "turn_conflict",
      message: "Turn x7 is not a turn of the target session.",
      next_action: "Read the target again and steer with the turn_id a started or steered result returned.",
    },
  },
  collapse_key_unsupported: {
    id: "relay.collapse_key_unsupported",
    slots: { device: "dev-b" },
    want: {
      code: "unsupported",
      message: "collapse_key reaches sessions on this device only; the delivery to device dev-b was not sent.",
      next_action: "Send without collapse_key, or send from the device that holds the thread.",
    },
  },
  steer_needs_turn: {
    id: "relay.steer_needs_turn",
    slots: {},
    want: {
      code: "invalid_arguments",
      message: "A steer needs expected_turn_id (the target's current turn_epoch).",
      next_action: "Fix the arguments and send again.",
    },
  },
  caller_context_missing: {
    id: "relay.caller_context_missing",
    slots: {},
    want: {
      code: "caller_context_missing",
      message: "A gateway send needs the calling session's durable id.",
      next_action: "Retry from a session that passes its execution context.",
    },
  },
}

describe("the relay transport's refusal sentences, byte-equal to dev", () => {
  test.each(Object.keys(GOLDEN).map((name) => [name] as const))("%s", (name) => {
    const { id, slots, want } = GOLDEN[name] as (typeof GOLDEN)[string]
    const got = refusal(id, slots)
    const sentence: Sentence = { code: got.code, message: got.message, next_action: got.next_action }
    expect(sentence).toEqual(want)
  })

  test("#given the relay templates #when listed #then every one is pinned by a golden", () => {
    const pinned = new Set(Object.values(GOLDEN).map((golden) => golden.id))
    expect(Object.keys(RELAY_TEXTS).filter((id) => !pinned.has(id as RefusalId))).toEqual([])
  })

  test("#given a slot value that looks like a template #when rendered #then it is written as given", () => {
    const got = refusal("relay.no_session_file", { device: "{device}", thread: "{{x}}" })
    expect(got.message).toBe("Device {device} holds no session file for {{x}}.")
    expect(provenanceOf(got)).toEqual({ id: "relay.no_session_file", slots: { device: "{device}", thread: "{{x}}" } })
  })
})
