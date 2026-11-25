import { REFUSAL_CODES } from "../gateway/result"
import type { RefusalText } from "../refusal-texts"

const LIST_ALL = "Call thread_list with all_scope (tool.thread_list({{ all_scope: true }}) in an eval cell)"
const ADDRESS_ANOTHER = "Address another thread."
const IDEMPOTENCY_UNCERTAIN = "The earlier operation may have been delivered."
const READ_BEFORE_RESEND = "Read the thread before deciding whether to send again."
const RETRY_SAME_KEY = "Retry with the same idempotency_key; a repeat of this delivery is never delivered twice."
const UNKNOWN_ADMISSION = "Device {device} accepted the message but answered an unknown admission ({kind})."
const PAIR_LOOP_UNCOUNTED =
  "Device {device} held this send back: this device sent that session its whole burst; it was not delivered."
const PAIR_LOOP_WAIT =
  "This looks like a send loop between these two sessions; wait before sending to that session again."
const HELD_STEER_ENDED =
  "Turn {turn} of {session} on device {device} ended while that session's open draft held the steer; it was not delivered."
// The gateway's own steer refusals (gateway/result.ts): a relayed steer answers the same code and recovery step.
const TURN_CONFLICT = REFUSAL_CODES.turn_conflict
const NOT_STEERABLE = REFUSAL_CODES.not_steerable

/**
 * The relay transport's refusal templates (relay.*), composed into the one registry (`refusal-texts.ts`). Each is the
 * sentence `relay-transport.ts` answered before it moved here, byte for byte (`refusal-texts.golden.test.ts`); where the
 * code was computed (a steer refusal), there is one template per code. The pair loop guard's counted sentences are slots
 * filled by `pairLoopGuardMessage` / `pairLoopGuardNextAction`, shared with the same-device send.
 */
export const RELAY_TEXTS = {
  "relay.state_read_unanswered": {
    code: "host_unavailable",
    message: "Device {device} did not answer the state read ({reason}); nothing was sent there.",
    next_action: "Retry; nothing needs to be checked first.",
  },
  "relay.wake_session_gone": {
    code: "not_found",
    message: "Device {device} holds no session file for that id.",
    next_action: `${LIST_ALL}.`,
  },
  "relay.wake_ambiguous_session": {
    code: "ambiguous_target",
    message: "Device {device} holds more than one session file with that id; none was picked.",
    next_action: "Address another thread, or resolve the duplicate on that device.",
  },
  "relay.wake_not_wakeable": {
    code: "not_resumable",
    message: "Device {device} cannot wake that session ({reason}).",
    next_action: ADDRESS_ANOTHER,
  },
  "relay.wake_queue_full": {
    code: "queue_full",
    message: "The session on device {device} has a full backlog.",
    next_action: "Retry later.",
  },
  "relay.wake_overloaded": {
    code: "overloaded",
    message: "Device {device} is waking too many sessions now.",
    next_action: "Retry after the given delay.",
  },
  "relay.wake_pair_loop_guard": { code: "pair_loop_guard", message: "{guard}", next_action: "{guard_next}" },
  "relay.wake_pair_loop_guard_no_retry": { code: "pair_loop_guard", message: "{guard}", next_action: PAIR_LOOP_WAIT },
  "relay.wake_pair_loop_guard_no_window": {
    code: "pair_loop_guard",
    message: PAIR_LOOP_UNCOUNTED,
    next_action: "{guard_next}",
  },
  "relay.wake_pair_loop_guard_bare": {
    code: "pair_loop_guard",
    message: PAIR_LOOP_UNCOUNTED,
    next_action: PAIR_LOOP_WAIT,
  },
  "relay.wake_limit_reached": {
    code: "overloaded",
    message: "The session on device {device} reached its limit of unattended wakes; the message stays queued there.",
    next_action: "Wait for a person to use that session.",
  },
  "relay.wake_no_process": {
    code: "host_unavailable",
    message: "No omo process on device {device} can take the message now.",
    next_action: "Start omo once on that device, then retry.",
  },
  "relay.wake_unsupported": {
    code: "unsupported",
    message: "Device {device} cannot wake a session that is not running.",
    next_action: "Update omo on that device.",
  },
  "relay.wake_refused": {
    code: "unsupported",
    message: "Device {device} refused the message ({reason}).",
    next_action: ADDRESS_ANOTHER,
  },
  "relay.wake_refused_unrecognised": {
    code: "unsupported",
    message: "Device {device} refused the message (unrecognised reason).",
    next_action: ADDRESS_ANOTHER,
  },
  "relay.held_steer_ended_turn_conflict": {
    code: TURN_CONFLICT.code,
    message: HELD_STEER_ENDED,
    next_action: TURN_CONFLICT.next,
  },
  "relay.held_steer_ended_not_steerable": {
    code: NOT_STEERABLE.code,
    message: HELD_STEER_ENDED,
    next_action: NOT_STEERABLE.next,
  },
  "relay.idempotency_conflict": {
    code: "idempotency_conflict",
    message: "The idempotency key was already used with different arguments.",
    next_action: "Retry with a new idempotency_key.",
  },
  "relay.idempotency_uncertain": {
    code: "idempotency_uncertain",
    message: IDEMPOTENCY_UNCERTAIN,
    next_action: "Read the target transcript before deciding whether to retry.",
  },
  "relay.idempotency_in_progress": {
    code: "idempotency_in_progress",
    message: "The same operation is already in progress.",
    next_action: "Wait for the earlier call to settle, then retry.",
  },
  "relay.no_session_file": {
    code: "not_found",
    message: "Device {device} holds no session file for {thread}.",
    next_action: `${LIST_ALL}.`,
  },
  "relay.no_running_owner": {
    code: "not_resumable",
    message: "No running owner for {thread} on device {device}.",
    next_action: "Open the thread on that device before sending.",
  },
  "relay.reopen_no_row": {
    code: "internal_error",
    message: "Reopening {thread} on device {device} answered no row.",
    next_action: "Retry the send.",
  },
  "relay.running_key_unlocated": {
    code: "not_resumable",
    message: "Device {device} runs {thread}, but the key it runs under cannot be found there ({reason}).",
    next_action: `${LIST_ALL}, then send again.`,
  },
  "relay.steer_not_running": {
    code: TURN_CONFLICT.code,
    message: "{thread} on device {device} is not running, so no turn of it can be steered.",
    next_action: TURN_CONFLICT.next,
  },
  "relay.steer_refused_turn_conflict": {
    code: TURN_CONFLICT.code,
    message: "A steer to {session} on device {device} was refused: turn_conflict.",
    next_action: TURN_CONFLICT.next,
  },
  "relay.steer_refused_not_steerable": {
    code: NOT_STEERABLE.code,
    message: "A steer to {session} on device {device} was refused: not_steerable.",
    next_action: NOT_STEERABLE.next,
  },
  "relay.admit_unsupported": {
    code: "unsupported",
    message:
      "Device {device} runs an engine without admit_external_message ({reason}); a peer message cannot be delivered there as a delivery.",
    next_action: "Update omo and senpi on that device, then retry.",
  },
  "relay.steer_turn_ended": {
    code: TURN_CONFLICT.code,
    message: "Turn {turn} is no longer the running turn of {session} on device {device}.",
    next_action: TURN_CONFLICT.next,
  },
  "relay.unknown_admission": {
    code: "idempotency_uncertain",
    message: UNKNOWN_ADMISSION,
    next_action: READ_BEFORE_RESEND,
  },
  "relay.wake_delivery_uncertain": {
    code: "idempotency_uncertain",
    message:
      "Delivery {delivery} to device {device} may still be delivered when that device wakes the session ({reason}).",
    next_action: RETRY_SAME_KEY,
  },
  "relay.wake_unknown_admission": {
    code: "idempotency_uncertain",
    message: UNKNOWN_ADMISSION,
    next_action: RETRY_SAME_KEY,
  },
  "relay.prompt_steer_refused_not_steerable": {
    code: NOT_STEERABLE.code,
    message: "A steer to {session} was refused: not_steerable.",
    next_action: NOT_STEERABLE.next,
  },
  "relay.prompt_steer_refused_turn_conflict": {
    code: TURN_CONFLICT.code,
    message: "A steer to {session} was refused: turn_conflict.",
    next_action: TURN_CONFLICT.next,
  },
  "relay.prompt_turn_unconfirmed": {
    code: TURN_CONFLICT.code,
    message: "Turn {turn} of {session} cannot be confirmed on device {device}.",
    next_action: TURN_CONFLICT.next,
  },
  "relay.prompt_turn_mismatch": {
    code: TURN_CONFLICT.code,
    message: "Turn {turn} is not the running turn of {session} on device {device}.",
    next_action: TURN_CONFLICT.next,
  },
  "relay.prompt_wait_unreported": {
    code: "idempotency_uncertain",
    message: "Device {device} accepted the message but did not report where it waits.",
    next_action: READ_BEFORE_RESEND,
  },
  "relay.cli_sender": {
    code: "unsupported",
    message:
      "A command-line sender cannot reach a session on device {device}: the engine admits a command-line delivery only from its own machine.",
    next_action: "Use omo remote send {device}/{session} instead.",
  },
  "relay.turn_not_a_turn": {
    code: "turn_conflict",
    message: "Turn {turn} is not a turn of the target session.",
    next_action: "Read the target again and steer with the turn_id a started or steered result returned.",
  },
  "relay.collapse_key_unsupported": {
    code: "unsupported",
    message: "collapse_key reaches sessions on this device only; the delivery to device {device} was not sent.",
    next_action: "Send without collapse_key, or send from the device that holds the thread.",
  },
  "relay.steer_needs_turn": {
    code: "invalid_arguments",
    message: "A steer needs expected_turn_id (the target's current turn_epoch).",
    next_action: "Fix the arguments and send again.",
  },
  "relay.caller_context_missing": {
    code: "caller_context_missing",
    message: "A gateway send needs the calling session's durable id.",
    next_action: "Retry from a session that passes its execution context.",
  },
} as const satisfies Readonly<Record<`relay.${string}`, RefusalText>>
