import { parseShardBasename, readOwnHostSocket, TASK_TOOL_NAME } from "@oh-my-opencode/senpi-task"

/**
 * Whether this session runs inside a Desktop thread host: the Desktop's per-thread hosts are `i-*`
 * endpoints, read from the host socket the session context carries. Such a session warms its child
 * shard when the model begins a delegating tool call, not on its first prompt.
 */
export function runsInDesktopThreadHost(pi: unknown): boolean {
  const socket = readOwnHostSocket(pi)
  return socket !== undefined && parseShardBasename(socket)?.kind === "i"
}

const DELEGATION_TOOLS: ReadonlySet<string> = new Set([TASK_TOOL_NAME, "task_send"])

/**
 * Whether a `message_update` opens a `task` or `task_send` call: its `toolcall_start` event, which
 * senpi streams with the call's name before any argument arrives. Every other update (every text
 * and argument delta) is rejected on its event type first, so the per-token cost stays one read.
 */
export function startsDelegation(payload: unknown): boolean {
  if (!isRecord(payload)) return false
  const event = payload["assistantMessageEvent"]
  if (!isRecord(event) || event["type"] !== "toolcall_start") return false
  const partial = event["partial"]
  const index = event["contentIndex"]
  if (!isRecord(partial) || !Array.isArray(partial["content"]) || typeof index !== "number") return false
  const block: unknown = partial["content"][index]
  return isRecord(block) && block["type"] === "toolCall" && typeof block["name"] === "string" && DELEGATION_TOOLS.has(block["name"])
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
