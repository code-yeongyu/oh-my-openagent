import { log } from "@oh-my-opencode/utils/logger"
import { authRequiredError, type RpcObject, type RpcRequest } from "@oh-my-opencode/senpi-task/rpc-socket-client"

const MUTATIONS: ReadonlySet<string> = new Set(["prompt", "interrupt", "set_session_name", "set_model", "set_thinking_level", "wake", "release_session", "extension_ui_response"])

function errorCodeOf(frame: RpcObject): unknown {
  return frame.errorCode ?? frame.error
}

function errorReasonOf(frame: RpcObject): unknown {
  const data = frame.errorData
  return typeof data === "object" && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>).reason : undefined
}

// Commands whose reply union carries the host's refusal (ReleaseSessionReply, UiAnswerReply): their callers branch
// on the refusal code, so an attach refusal is answered as that command's own refusal frame instead of a throw.
const TYPED_REFUSAL: ReadonlySet<string> = new Set(["release_session", "extension_ui_response"])

type AttachRefusal = { readonly code: string; readonly errorData?: unknown; readonly frame: RpcObject }

/**
 * Attaches the selected session on this connection; undefined once attached, else the refusal. A
 * draining host refuses with the v1 code `session_busy_lifecycle` and `errorData.reason:
 * "host_draining"`: nothing was attached and the entry is unchanged, so it reads as the transient
 * `host_draining` (retry after the restart), never an abort or close. Only codes are read, never
 * `errorData.action`. `auth_required` is never a session refusal and always throws.
 */
async function attachSelectedSession(request: RpcRequest, socketPath: string, sessionId: unknown, durableSessionId: string): Promise<AttachRefusal | undefined> {
  const frame = await request({ type: "attach_session", sessionId, durableSessionId })
  if (frame.success === true) return undefined
  const code = errorCodeOf(frame)
  if (code === "auth_required") throw authRequiredError(socketPath)
  if (code === "session_busy_lifecycle" && errorReasonOf(frame) === "host_draining") return { code: "host_draining", errorData: frame.errorData, frame }
  return { code: typeof code === "string" ? code : "attach_refused", ...(frame.errorData === undefined ? {} : { errorData: frame.errorData }), frame }
}

function attachRefusalError(refusal: AttachRefusal, socketPath: string, sessionId: unknown): Error {
  if (refusal.code === "host_draining") return new Error(`host_draining:${socketPath}`)
  if (refusal.code === "session_not_attached") return new Error(`session_not_attached:${String(sessionId)}`)
  return new Error(`thread RPC request failed: ${JSON.stringify(refusal.frame.error ?? refusal.frame)}`)
}

/**
 * Releases the hold after the mutation already took effect, so no outcome here may turn that
 * success into an error. `session_not_attached` means the hold is already gone: released. Any
 * other refusal or a lost connection leaves at most a connection-local hold the host drops when
 * this one-shot connection closes; it is logged once and the mutation's result stands.
 */
async function releaseAttachment(request: RpcRequest, command: RpcObject): Promise<void> {
  const sessionId = command.sessionId
  let failure: string
  try {
    const frame = await request({ type: "release_attachment", sessionId })
    const code = errorCodeOf(frame)
    // A session the mutation released has left the host, taking its hold with it.
    if (frame.success === true || code === "session_not_attached" || (command.type === "release_session" && code === "unknown_session")) return
    failure = JSON.stringify(frame.error ?? frame)
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  }
  log(`thread rpc: release_attachment for ${String(sessionId)} failed after the mutation took effect: ${failure}`)
}

/**
 * Runs one command on an authenticated connection under the v1.1 attachment fence. Only a
 * session-scoped mutation is fenced, as the host gates only commands that name a session: a wake
 * with no routing id carries no `sessionId` and is sent as it always was.
 */
export async function fencedCommand(
  request: RpcRequest,
  socketPath: string,
  command: RpcObject,
  capabilities: ReadonlySet<unknown>,
  durableSessionId: string | undefined,
  send: () => Promise<RpcObject>,
): Promise<RpcObject> {
  const attach = MUTATIONS.has(String(command.type)) && command.sessionId !== undefined && capabilities.has("attach_session")
    && (command.type !== "release_session" || capabilities.has("release_caller_aware"))
  if (!attach) return await send()
  if (durableSessionId === undefined) throw new Error("session_identity_mismatch:missing selected durable session id")
  const refusal = await attachSelectedSession(request, socketPath, command.sessionId, durableSessionId)
  if (refusal !== undefined) {
    if (!TYPED_REFUSAL.has(String(command.type))) throw attachRefusalError(refusal, socketPath, command.sessionId)
    return { id: command.id, type: "response", command: command.type, success: false, error: refusal.code, errorCode: refusal.code, ...(refusal.errorData === undefined ? {} : { errorData: refusal.errorData }) }
  }
  const result = await send()
  if (capabilities.has("release_attachment")) await releaseAttachment(request, command)
  return result
}
