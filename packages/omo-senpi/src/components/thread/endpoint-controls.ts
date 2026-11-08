/**
 * Which session controls a thread's endpoint accepts. A host takes them all. A terminal control
 * endpoint takes what its `get_protocol_info` lists in `commands`; a terminal from before senpi's
 * session controls lists none and takes only the read-mostly set (`LEGACY_TUI_COMMANDS`).
 */
import type { EndpointKind } from "./endpoint-registry"

export type ThreadControl = "send" | "read" | "rename" | "set_model" | "set_reasoning" | "interrupt"

const ALL_CONTROLS: readonly ThreadControl[] = ["send", "read", "rename", "set_model", "set_reasoning", "interrupt"]

/** The commands each control sends; a control is accepted when every one of them is. */
const CONTROL_COMMANDS: Readonly<Record<ThreadControl, readonly string[]>> = {
  send: ["wake"],
  read: ["get_messages"],
  rename: ["set_session_name"],
  set_model: ["get_available_models", "set_model"],
  set_reasoning: ["get_available_thinking_levels", "set_thinking_level"],
  interrupt: ["interrupt"],
}

/** senpi `session-control-commands.ts` before the session controls: a terminal that lists no `commands`. */
export const LEGACY_TUI_COMMANDS: ReadonlySet<string> = new Set([
  "get_protocol_info",
  "list_sessions",
  "get_state",
  "get_messages",
  "set_session_name",
  "wake",
  "subscribe",
  "extension_ui_response",
])

export function tuiCommandsFrom(protocolInfo: unknown): ReadonlySet<string> {
  const commands = typeof protocolInfo === "object" && protocolInfo !== null && "commands" in protocolInfo ? protocolInfo.commands : undefined
  if (!Array.isArray(commands)) return LEGACY_TUI_COMMANDS
  return new Set(commands.filter((command): command is string => typeof command === "string"))
}

export function acceptedControls(kind: EndpointKind, tuiCommands: ReadonlySet<string> | undefined): readonly ThreadControl[] {
  if (kind !== "tui") return ALL_CONTROLS
  const accepted = tuiCommands ?? LEGACY_TUI_COMMANDS
  return ALL_CONTROLS.filter((control) => CONTROL_COMMANDS[control].every((command) => accepted.has(command)))
}
