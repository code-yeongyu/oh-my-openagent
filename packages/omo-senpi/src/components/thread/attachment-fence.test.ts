import { describe, expect, test } from "bun:test"
import type { RpcObject } from "@oh-my-opencode/senpi-task/rpc-socket-client"
import { fencedCommand } from "./attachment-fence"

const CAPABILITIES: ReadonlySet<unknown> = new Set(["attach_session", "release_attachment", "release_caller_aware"])

function recorder() {
  const sent: string[] = []
  const request = async (command: RpcObject): Promise<RpcObject> => {
    sent.push(String(command.type))
    return command.type === "attach_session" ? { success: true, data: { sessionId: command.sessionId, attached: true } } : { success: true, data: { deferred: false } }
  }
  return { sent, request }
}

async function run(type: string) {
  const { sent, request } = recorder()
  const command: RpcObject = { type, sessionId: "rpc-1" }
  await fencedCommand(request, "/tmp/host.sock", command, CAPABILITIES, "dur-selected", async () => {
    sent.push(type)
    return { success: true, data: {} }
  })
  return sent
}

// Protocol contract (wire contract v1.1, design 3b): the host gates every session command except these reads,
// as senpi's attachment gate lists them (ATTACH_GATE_EXEMPT). A read the host exempts must reach it unfenced.
const HOST_EXEMPT_READS = [
  "get_protocol_info", "list_sessions", "subscribe_sessions", "unsubscribe_sessions", "get_subscription_limits", "warm",
  "detach_connection", "open_session", "attach_session", "reclaim_session", "get_effect_status", "get_state", "get_messages",
  "get_entries", "get_tree", "get_fork_messages", "get_last_assistant_text", "get_media", "get_commands", "get_loaded_surfaces",
  "get_available_models", "get_available_thinking_levels", "get_fast_mode", "get_session_stats", "get_pending_inputs",
  "get_steering_messages", "get_follow_up_messages", "get_auth_providers", "get_provider_accounts", "resolve_path",
  "memory_report", "eval_cells.list", "eval_cells.peek", "check_reload_veto",
] as const

describe("attachment fence: deny by default, like the host's gate", () => {
  test("#given a session command the client does not know yet #when it is sent to an attach-capable host #then it is fenced: attach_session, the command, release_attachment", async () => {
    expect(await run("future_mutation")).toEqual(["attach_session", "future_mutation", "release_attachment"])
  })

  test.each(HOST_EXEMPT_READS)("#given the host-exempt read %s with a session id #when it is sent #then it goes out unfenced", async (type) => {
    expect(await run(type)).toEqual([type])
  })
})
