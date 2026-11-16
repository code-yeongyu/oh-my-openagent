import type { CommandOutcome, CommandRpc, JsonObject } from "../../../src/local-api/protocol.ts"

// The fake owner's failure modes (design one-remote-module v6 section 9). Each one keeps exactly one answer back, so a
// deadline row runs against it on fake time:
// - `silent-handshake`: accepts the socket and reads the hello, never welcomes.
// - `silent-requests`: completes the handshake, never answers a request.
// - `ack-no-final`: answers session.command with its command_id and the progress states, never the engine's reply or a
//   final state.
// - `attach-stall`: grants session.attach, never sends the snapshot (nor anything else of that attach).
// - `silent-session`: attach succeeds with its snapshot, then no record ever; commands are still answered, so a liveness
//   probe (get_state) succeeds while the session is silent.
// - `terminal`: a terminal's engine endpoint, which takes only `terminalCommands` and answers any other record as an
//   unknown command (the failed envelope a senpi engine writes).
// They use only the local API's own vocabulary, so they move with the fake owner into relay-daemon's shared
// `@sisyphuslabs/relay-daemon-local-api/testing` (design v6 V12).
export type FakeOwnerMode =
  "silent-handshake" | "silent-requests" | "ack-no-final" | "attach-stall" | "silent-session" | "terminal"

/** What a mode kept back, reported at the moment it would have been sent, so a test moves its clock only after it. */
export type Withheld = "welcome" | "response" | "final_state" | "snapshot" | "records"

/** senpi `session-control-commands.ts` before the session controls (omo-senpi endpoint-controls.ts LEGACY_TUI_COMMANDS). */
export const LEGACY_TERMINAL_COMMANDS: readonly string[] = [
  "get_protocol_info",
  "list_sessions",
  "get_state",
  "get_messages",
  "set_session_name",
  "wake",
  "subscribe",
  "extension_ui_response",
]

/** A current terminal: every session control but the lifecycle records (close_session, unload_session). */
export const TERMINAL_COMMANDS: readonly string[] = [
  ...LEGACY_TERMINAL_COMMANDS,
  "interrupt",
  "get_available_models",
  "set_model",
  "get_available_thinking_levels",
  "set_thinking_level",
]

const PROGRESS_STATES: ReadonlySet<CommandOutcome["state"]> = new Set([
  "queued",
  "transport_confirmed",
  "engine_dispatched",
])

export const isProgress = (outcome: CommandOutcome): boolean => PROGRESS_STATES.has(outcome.state)

export const engineReply = (rpc: CommandRpc, data: JsonObject, accepted: boolean): JsonObject => {
  const head = { type: "response", id: rpc["id"] ?? null, command: rpc["type"] ?? null }
  return accepted
    ? { ...head, success: true, data }
    : { ...head, success: false, error: `Unknown command: ${String(rpc["type"])}` }
}

export const terminalTakes = (commands: ReadonlySet<string>, rpc: CommandRpc): boolean => {
  const type = rpc["type"]
  return typeof type === "string" && commands.has(type)
}
