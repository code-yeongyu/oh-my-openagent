import type { GuidanceText, RefusalText } from "../refusal-texts"

const UPDATE_HERE = "Update omo on this device and restart its host."
const LIST_ALL_THEN_OPEN =
  "Call thread_list with all_scope (tool.thread_list({ all_scope: true }) in an eval cell), then open the thread by the id it lists."
const LIST_ALL_FIND_NEW =
  "Call thread_list with all_scope (tool.thread_list({ all_scope: true }) in an eval cell) to find the new thread."
const UNREACHABLE_NEXT =
  "Start omo on that device (an omo session, or omo daemon run), or create the thread on another device."
const PICK_EXACT =
  "Call thread_list (tool.thread_list() in an eval cell) and pass the exact thread value of the intended thread."
const ADDRESS_INPUT_NEXT =
  "Pass a thread value or a unique name from thread_list (tool.thread_list() in an eval cell) as the {what}."
const OUT_OF_SCOPE_NEXT =
  "Call thread_list with all_scope (tool.thread_list({ all_scope: true }) in an eval cell) to see it, then retry with all_scope set, or target a thread in this workspace."
const THINKING_NEXT = "Choose a level from the supported list and retry."
const WORKTREE_LEFT = " The worktree {worktree} made for it is still on that device."

/**
 * The thread controls' refusal templates (control.*), composed into the one registry (`refusal-texts.ts`). Each is the
 * sentence its call site built by hand before (#14951), byte for byte: `{slot}` takes the value that site interpolated,
 * computed there exactly as before (String(), JSON.stringify(), a joined list).
 */
export const CONTROL_TEXTS = {
  "control.close_working_unnamed": {
    code: "turn_active",
    message:
      "Thread {thread} is still working ({state}), and its host's engine cannot name the messages a forced close would drop.",
    next_action:
      "Wait for it to read them, or close it with force: true (anything it has not read is dropped); an engine that names them comes with a newer senpi on that device.",
  },
  "control.close_unread_unnamed": {
    code: "turn_active",
    message: "Thread {thread} holds messages it has not read ({state}), and its host's engine cannot name them.",
    next_action:
      "Wait for it to read them, or close it with force: true (anything it has not read is dropped); an engine that names them comes with a newer senpi on that device.",
  },
  "control.close_unread": {
    code: "turn_active",
    message:
      "Thread {thread} has {count} message(s) it has not read yet ({deliveries}); closing it now would drop them.",
    next_action:
      "Let it read them and retry, or close it with force: true to drop them (the result lists dropped_deliveries).",
  },
  "control.close_not_graceful": {
    code: "unsupported",
    message:
      "The engine holding thread {thread} cannot close it gracefully: it runs a senpi from before graceful close.",
    next_action:
      "Update omo on that device and restart its host, or close the thread with force: true (its running turn is stopped).",
  },
  "control.close_no_time": {
    code: "unsupported",
    message: "This call has no time left to wait for thread {thread}'s turn.",
    next_action: "Close it again in a new call.",
  },
  "control.close_still_working": {
    code: "turn_active",
    message:
      "Thread {thread} is still working on turn {turn} after {waited_ms} ms. It stays open and takes messages again; the {returned} unread message(s) taken out of its queue are queued for it again.",
    next_action:
      "Close it again with a longer wait_ms once its turn is nearly done, or with force: true to stop the turn.",
  },
  "control.close_still_working_capped": {
    code: "turn_active",
    message:
      "Thread {thread} is still working on turn {turn} after {waited_ms} ms (the most a thread on another device can wait, not the {requested_ms} ms asked for). It stays open and takes messages again; the {returned} unread message(s) taken out of its queue are queued for it again.",
    next_action: "Close it again once its turn is nearly done, or with force: true to stop the turn.",
  },
  "control.close_composer_draft": {
    code: "unsupported",
    message: "Thread {thread}'s terminal has unsent text in its composer, and a close would discard it.",
    next_action: "Ask the person at that terminal to send or clear it, then close the thread again.",
  },
  "control.close_host_draining": {
    code: "host_unavailable",
    message: "The host holding thread {thread} is shutting down and refused to close it.",
    next_action: "Retry once that host has restarted.",
  },
  "control.close_refused": {
    code: "unsupported",
    message: "The host holding thread {thread} refused to close it ({reason}).",
    next_action: "Read the thread and retry once its work settles.",
  },
  "control.close_refused_detail": {
    code: "unsupported",
    message: "The host holding thread {thread} refused to close it ({reason}: {detail}).",
    next_action: "Read the thread and retry once its work settles.",
  },
  "control.close_terminal_graceful_only": {
    code: "unsupported",
    message: "Thread {thread} belongs to an interactive terminal, which closes only gracefully.",
    next_action:
      "Close it with graceful: true (the terminal exits once its turn ends), or use thread_interrupt (tool.thread_interrupt() in an eval cell) to stop its turn.",
  },
  "control.close_not_accepted": {
    code: "unsupported",
    message: "The host holding thread {thread} does not accept close requests.",
    next_action: UPDATE_HERE,
  },
  "control.wait_unsupported": {
    code: "unsupported",
    message: "The host holding thread {thread} cannot report when its turn ends.",
    next_action: UPDATE_HERE,
  },
  "control.status_refused": {
    code: "unsupported",
    message: "The endpoint holding thread {thread} refused to report its status ({reason}).",
    next_action: UPDATE_HERE,
  },
  "control.archive_unsupported": {
    code: "unsupported",
    message:
      "The engine holding thread {thread} does not know set_session_archived: it runs a senpi from before archived threads.",
    next_action: "Update omo on this device and restart the session's host or terminal, then retry.",
  },
  "control.close_held_elsewhere": {
    code: "foreign_live_owner",
    message:
      "Thread {thread} has no session file yet and another client still holds it, so only this tool's hold was released.",
    next_action:
      "Close it from the client that holds it, or send it a message first so it can be closed for every holder.",
  },
  "control.thinking_level_unsupported": {
    code: "thinking_level_unsupported",
    message: 'Thinking level "{level}" is not supported by the active model.',
    next_action: THINKING_NEXT,
  },
  "control.thinking_level_unsupported_on_device": {
    code: "thinking_level_unsupported",
    message: "Thinking level {level} is not supported by the active model.",
    next_action: THINKING_NEXT,
  },
  "control.thread_opening": {
    code: "host_unavailable",
    message: "Thread {thread} is opening on its host and cannot accept controls yet.",
    next_action: "Retry once the thread is open.",
  },
  "control.rename_conflict": {
    code: "name_conflict",
    message: 'A thread named "{name}" already exists.',
    next_action: "Call thread_list (tool.thread_list() in an eval cell) and choose another name.",
  },
  "control.receipt_recovery_full": {
    code: "overloaded",
    message:
      "{max_keys} earlier calls on this surface failed before the gateway store answered and may still need recovering; nothing ran.",
    next_action: "Retry those calls under their own idempotency keys, then retry this one.",
  },
  "control.launch_fields_for_new": {
    code: "invalid_arguments",
    message: "{fields} apply to a new thread; thread opens an existing one as it is.",
    next_action: "Drop them to open the thread, or drop thread to create a new one with them.",
  },
  "control.launch_model_shape": {
    code: "invalid_arguments",
    message: "model {model} is not a provider/id.",
    next_action:
      "Pass the exact provider/id the device lists (thread_set_model, tool.thread_set_model() in an eval cell, shows them).",
  },
  "control.launch_preset_wider": {
    code: "scope_denied",
    message: "This session runs in {creator}; a thread it creates cannot run in {requested}, which allows more.",
    next_action:
      "Pass this session's own mode or a narrower one (ask is always allowed), or leave permission_preset unset.",
  },
  "control.create_skill_names": {
    code: "invalid_arguments",
    message: "Not a skill name: {names}. Pass the names of installed skills, never a path or text.",
    next_action: "Pass skill names as listed by the skill index.",
  },
  "control.create_prompt_not_started": {
    code: "prompt_not_started",
    message:
      "Thread {thread} was created{where}, but its first prompt did not start a turn (its delivery is {state}{waiting}).",
    next_action:
      "The thread exists: read it with thread_read (tool.thread_read({{ thread }}) in an eval cell) to see whether the prompt ran, then send the prompt again with thread_send to {thread} (tool.thread_send({{ thread, message }}) in an eval cell) if it did not. Do not create the thread again.",
  },
  "control.create_prompt_queued_next": {
    guidance:
      "The prompt is stored and runs when {thread} wakes: do not send it again. Check it with thread_read (tool.thread_read({{ thread }}) in an eval cell).",
  },
  "control.create_prompt_queued_next_on_device": {
    guidance:
      "The prompt is stored on device {device} and runs when {thread} wakes: do not send it again. Check it with thread_read (tool.thread_read({{ thread }}) in an eval cell).",
  },
  "control.create_prompt_undelivered": {
    code: "internal_error",
    message: "The thread was created, but its first prompt was not delivered: {error}.",
    next_action:
      "Send it with thread_send to {thread} (tool.thread_send({{ thread, message }}) in an eval cell); read the thread first if the prompt may have arrived.",
  },
  "control.create_prompt_schema_too_new": {
    code: "gateway_schema_too_new",
    message:
      "The thread was created, but its first prompt was not delivered: this omo build reads gateway schema {supported}, while this machine's gateway store is at schema {found}: a newer omo build already upgraded it.",
    next_action:
      "Update omo with `omo update`, then send the prompt with thread_send to {thread} (tool.thread_send({{ thread, message }}) in an eval cell).",
  },
  "control.open_model_unavailable": {
    code: "model_not_found",
    message: "No thread was created: {where} cannot run {model}.",
    next_action:
      "Pass a provider/id {where} has (thread_set_model, tool.thread_set_model() in an eval cell, lists them), or leave model unset for its default.",
  },
  "control.open_fork_not_local": {
    code: "not_found",
    message: "No thread was created: {source} is not a session {where} holds, so its engine cannot fork it.",
    next_action:
      "A fork is made on the device that holds its source: call thread_list with all_scope (tool.thread_list({{ all_scope: true }}) in an eval cell) to find that device, and fork the thread by the id listed there.",
  },
  "control.open_fork_not_found": {
    code: "not_found",
    message: "No thread was created: {where} has no readable session file for {source} to fork.",
    next_action:
      "Call thread_list with all_scope (tool.thread_list({{ all_scope: true }}) in an eval cell) and fork a thread it lists.",
  },
  "control.relay_made_unowned": {
    code: "host_unavailable",
    message:
      "Device {device} made thread {thread}, but its route does not reach it ({reason}), and its open named no routing id to end it by: it is left with no live owner.",
    next_action: UNREACHABLE_NEXT,
  },
  "control.relay_made_unowned_worktree": {
    code: "host_unavailable",
    message: `Device {device} made thread {thread}, but its route does not reach it ({reason}), and its open named no routing id to end it by: it is left with no live owner.${WORKTREE_LEFT}`,
    next_action: UNREACHABLE_NEXT,
  },
  "control.relay_made_end_failed": {
    code: "host_unavailable",
    message:
      "Device {device} made thread {thread}, but its route does not reach it ({reason}), and ending it there failed: it is left with no live owner.",
    next_action: UNREACHABLE_NEXT,
  },
  "control.relay_made_end_failed_worktree": {
    code: "host_unavailable",
    message: `Device {device} made thread {thread}, but its route does not reach it ({reason}), and ending it there failed: it is left with no live owner.${WORKTREE_LEFT}`,
    next_action: UNREACHABLE_NEXT,
  },
  "control.relay_open_unreachable": {
    code: "host_unavailable",
    message:
      "Device {device} took the open, but its route does not reach the session it made ({reason}): no thread host there that this account reaches takes new threads. Nothing was left behind.",
    next_action: UNREACHABLE_NEXT,
  },
  "control.relay_open_unreachable_worktree": {
    code: "host_unavailable",
    message: `Device {device} took the open, but its route does not reach the session it made ({reason}): no thread host there that this account reaches takes new threads.${WORKTREE_LEFT}`,
    next_action: UNREACHABLE_NEXT,
  },
  "control.relay_reopen_unreachable": {
    code: "not_resumable",
    message: "Device {device} opened the thread's file, but the reopened session cannot be reached there ({reason}).",
    next_action: LIST_ALL_THEN_OPEN,
  },
  "control.relay_open_unnamed": {
    code: "internal_error",
    message: "Device {device} opened a session but did not name it.",
    next_action: LIST_ALL_FIND_NEW,
  },
  "control.relay_key_unnamed": {
    code: "unsupported",
    message: "Device {device} created the thread but did not name its relay key ({reason}).",
    next_action:
      "Address it by its thread value once thread_list with all_scope (tool.thread_list({{ all_scope: true }}) in an eval cell) lists it, or update omo on that device.",
  },
  "control.relay_no_device": {
    code: "not_found",
    message: "No device named {device} is signed in to this account.",
    next_action:
      "Call thread_list with all_scope (tool.thread_list({{ all_scope: true }}) in an eval cell) to see the account's devices and threads.",
  },
  "control.reply_sender_ambiguous": {
    code: "ambiguous_target",
    message: '"{address}" names more than one sender of this run\'s deliveries; none was picked.',
    next_action: "Send to the intended thread as a normal send, by its id.",
  },
  "control.address_not_string": {
    code: "invalid_arguments",
    message: "The {what} must be a string.",
    next_action: ADDRESS_INPUT_NEXT,
  },
  "control.address_control_characters": {
    code: "invalid_arguments",
    message: "The {what} contains control characters.",
    next_action:
      "Remove the control characters and retry, or pass an address from thread_list (tool.thread_list() in an eval cell).",
  },
  "control.address_empty": {
    code: "invalid_arguments",
    message: "The {what} is empty.",
    next_action: ADDRESS_INPUT_NEXT,
  },
  "control.address_outside_workspace": {
    code: "scope_denied",
    message: "Thread {thread} exists outside this workspace.",
    next_action:
      "Call thread_list with all_scope (tool.thread_list({{ all_scope: true }}) in an eval cell) to confirm the id, then retry with all_scope set, or target a thread in this workspace.",
  },
  "control.address_not_found": {
    code: "not_found",
    message: 'No visible thread matches "{target}" in {scope}.',
    next_action:
      "Call thread_list (tool.thread_list() in an eval cell) and pass a row's thread value or a unique name it returned.",
  },
  "control.address_not_found_id": {
    code: "not_found",
    message:
      'No visible thread matches "{target}" in {scope}. No reachable endpoint lists a thread with that thread_id.',
    next_action:
      "Call thread_list with all_scope (tool.thread_list({{ all_scope: true }}) in an eval cell) to check the id; a thread on a device that is offline is found once it is online.",
  },
  "control.address_not_found_session_id": {
    code: "not_found",
    message:
      'No visible thread matches "{target}" in {scope}. "{target}" is a session id, not a thread value. Pass the thread value thread_list (tool.thread_list() in an eval cell) shows, or omit thread / pass self for this session.',
    next_action: "Call thread_list (tool.thread_list() in an eval cell) and pass a row's thread value.",
  },
  "control.address_not_found_session_id_listed": {
    code: "not_found",
    message:
      'No visible thread matches "{target}" in {scope}. "{target}" is a session id, not a thread value. Pass the thread value thread_list (tool.thread_list() in an eval cell) shows, or omit thread / pass self for this session. Visible thread values: {threads}.',
    next_action: "Call thread_list (tool.thread_list() in an eval cell) and pass a row's thread value.",
  },
  "control.address_session_id_outside_workspace": {
    code: "scope_denied",
    message: 'Thread {thread} (session id "{target}") exists outside this workspace.',
    next_action:
      "Call thread_list with all_scope (tool.thread_list({{ all_scope: true }}) in an eval cell) and pass thread {thread}, or target a thread in this workspace.",
  },
  "control.address_session_id_ambiguous": {
    code: "ambiguous_target",
    message: '{count} visible threads share the session id "{target}". Pass one thread: {threads}.',
    next_action: PICK_EXACT,
  },
  "control.address_name_ambiguous": {
    code: "ambiguous_target",
    message: '{count} visible threads share the name "{target}".',
    next_action: PICK_EXACT,
  },
  "control.address_prefix_ambiguous": {
    code: "ambiguous_target",
    message: '{count} threads have an id starting with "{target}".',
    next_action: "Pass a longer prefix or the exact thread value from the candidates.",
  },
  "control.address_name_outside_workspace": {
    code: "scope_denied",
    message: 'A thread named "{target}" exists on this device outside this workspace.',
    next_action: OUT_OF_SCOPE_NEXT,
  },
  "control.address_names_outside_workspace": {
    code: "scope_denied",
    message: '{count} threads named "{target}" exist on this device outside this workspace.',
    next_action: OUT_OF_SCOPE_NEXT,
  },
  "control.address_fuzzy_too_short": {
    code: "invalid_arguments",
    message: 'A fuzzy query needs at least {min} characters; "{query}" is too short.',
    next_action:
      "Pass a longer query, or call thread_list (tool.thread_list() in an eval cell) and pass a row's thread value or a unique name it returned.",
  },
  "control.address_fuzzy_capped": {
    code: "ambiguous_target",
    message: "{count} threads are in scope; the fuzzy scan is capped at {cap}.",
    next_action:
      "Call thread_list (tool.thread_list() in an eval cell), pick the intended thread, and pass its thread value instead of a fuzzy query.",
  },
  "control.address_fuzzy_no_match": {
    code: "not_found",
    message: 'No thread scored close enough to "{query}" (best {best}).',
    next_action:
      "Call thread_list (tool.thread_list() in an eval cell) and pass a row's thread value, or retry with a longer, more distinctive query.",
  },
  "control.address_fuzzy_ambiguous": {
    code: "ambiguous_target",
    message: 'Several threads match "{query}" about equally (best {best}, runner-up {runner_up}).',
    next_action: PICK_EXACT,
  },
  "control.address_name_conflict": {
    code: "name_conflict",
    message: 'A thread named "{name}" ({thread}) already exists.',
    next_action:
      "Call thread_list (tool.thread_list() in an eval cell) to reuse that thread by id, or pass a different name for the new thread.",
  },
} as const satisfies Readonly<Record<`control.${string}`, RefusalText | GuidanceText>>
