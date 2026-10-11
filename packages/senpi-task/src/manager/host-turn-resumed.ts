// Synthesized on a daemon-session child's managed stream (never a host event): a host crash or a
// cut connection took the child mid-turn and the reattach left a turn running on the new
// generation - re-joined still streaming, or re-prompted. The child is past starting.
export const HOST_TURN_RESUMED_EVENT = "host_turn_resumed"
