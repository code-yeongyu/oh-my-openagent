// Synthesized on a daemon-session child's managed stream (never a host event): a host crash or a
// cut connection took the child mid-turn and the reattach left a turn running on the new
// generation - re-joined still streaming, or re-prompted. The child is past starting.
export const HOST_TURN_RESUMED_EVENT = "host_turn_resumed"

// Synthesized after a reattach stamped `awaiting_input` (senpi#3266): the resumed session's last
// turn ended aborted (or never answered) and idle, so the child cannot continue on its own. The
// live row leaves "starting" for "resumed, waiting for input" until real child motion arrives.
export const TASK_AWAITING_INPUT_EVENT = "task_awaiting_input"
