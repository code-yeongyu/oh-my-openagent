import {
  createJsonlLines,
  openRpcSocketStream,
  parseJsonObjectLine,
  RpcIdentityError,
  type RpcSocketStream,
  RpcStreamError,
} from "@oh-my-opencode/senpi-task/rpc-socket-client"
import { resolveTaskHostSocket } from "../../../../../senpi-task/src/runners/rpc-host/daemon-contract"
import { createSessionRecords, type SessionRecords } from "./session-records"
import type {
  AttachRpcSessionOptions,
  AttachRpcSessionResult,
  RpcRecord,
  RpcSessionErrorCode,
  RpcSessionFailure,
  RpcSessionStream,
  RpcSessionTarget,
} from "./types"

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000
const REJECTED_LINE_CHARS = 200
// The host's refusals that mean the session is not (or no longer) there.
const SESSION_GONE: ReadonlySet<string> = new Set(["unknown_session", "session_identity_mismatch"])

type Begun = { readonly kind: "ok"; readonly sessionId: string; readonly durableSessionId: string | undefined }

const failure = (code: RpcSessionErrorCode, message: string): RpcSessionFailure => ({
  kind: "error",
  error: { code, message },
})

const isRecord = (value: unknown): value is RpcRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined)

// The answer goes to an integration, so it names no local path: the transport's own messages carry the endpoint and key
// record paths (and chmod hints) for a person at this machine, and the code says what failed.
const IDENTITY_MESSAGES: Readonly<Record<RpcIdentityError["code"], string>> = {
  unsafe_key_record: "a key record of the host is not safe to use (its owner, mode or file type)",
  host_identity_unproven: "the host did not prove its identity",
  auth_failed: "the host refused this client's proof",
  auth_required: "the host requires authentication and no key record proves this client",
}

/** A failure reaching or speaking to the host, as data. */
function failureOf(error: unknown): RpcSessionFailure {
  if (error instanceof RpcIdentityError) return failure(error.code, IDENTITY_MESSAGES[error.code])
  if (error instanceof RpcStreamError)
    return failure(error.code, error.code === "not_running" ? "no host serves the endpoint" : error.message)
  const cause = error instanceof Error ? ("code" in error ? String(error.code) : error.name) : typeof error
  return failure("unreachable", `the host endpoint could not be used (${cause})`)
}

/** A host answer's data, or its refusal as data. */
function answerOf(
  reply: RpcRecord,
  what: string,
): { readonly kind: "ok"; readonly data: RpcRecord } | RpcSessionFailure {
  if (reply.success === true) return { kind: "ok", data: isRecord(reply.data) ? reply.data : {} }
  const code = text(reply.errorCode) ?? text(reply.error) ?? "refused"
  if (code === "auth_required") return failure("auth_required", `${what}: the host requires authentication`)
  return failure(SESSION_GONE.has(code) ? "session_not_found" : "refused", `${what}: ${code}`)
}

/**
 * The host names the opened session's durable id in the `session_opened` record it writes for the handle before it
 * answers (the answer's `state` does not carry it); an answer that names it is read as well.
 */
async function open(
  host: RpcSocketStream,
  session: SessionRecords,
  fields: RpcRecord,
  timeoutMs: number,
): Promise<Begun | RpcSessionFailure> {
  const answer = answerOf(await host.request({ ...fields, type: "open_session" }, timeoutMs), "open_session")
  if (answer.kind === "error") return answer
  const sessionId = text(answer.data.sessionId)
  if (sessionId === undefined) return failure("refused", "open_session answered no sessionId")
  const state = isRecord(answer.data.state) ? answer.data.state : {}
  const durableSessionId =
    session.openedDurableId(sessionId) ?? text(state.durableSessionId) ?? text(answer.data.durableSessionId)
  return { kind: "ok", sessionId, durableSessionId }
}

/** The host routes by its handle, so a durable id is looked up in its listing first, as the thread client does. */
async function attach(
  host: RpcSocketStream,
  durableSessionId: string,
  timeoutMs: number,
): Promise<Begun | RpcSessionFailure> {
  const listed = answerOf(await host.request({ type: "list_sessions" }, timeoutMs), "list_sessions")
  if (listed.kind === "error") return listed
  const rows = Array.isArray(listed.data.sessions) ? listed.data.sessions : []
  const row = rows.find((session) => isRecord(session) && session.durableSessionId === durableSessionId)
  const sessionId = isRecord(row) ? text(row.sessionId) : undefined
  if (sessionId === undefined) return failure("session_not_found", `no session ${durableSessionId} on the host`)
  const command = { type: "attach_session", sessionId, durableSessionId }
  const attached = answerOf(await host.request(command, timeoutMs), "attach_session")
  return attached.kind === "error" ? attached : { kind: "ok", sessionId, durableSessionId }
}

const begin = (host: RpcSocketStream, session: SessionRecords, target: RpcSessionTarget, timeoutMs: number) =>
  "open" in target
    ? open(host, session, target.open, timeoutMs)
    : attach(host, target.attach.durableSessionId, timeoutMs)

function streamOf(host: RpcSocketStream, session: SessionRecords, begun: Begun, timeoutMs: number): RpcSessionStream {
  const lines = createJsonlLines()
  const send = (record: RpcRecord): boolean => {
    if (session.isEnded()) return false
    host.send(session.tag(record))
    return true
  }
  return {
    sessionId: begun.sessionId,
    ...(begun.durableSessionId === undefined ? {} : { durableSessionId: begun.durableSessionId }),
    records: session.records,
    send,
    write: (chunk) => {
      let sent = 0
      const rejected: string[] = []
      for (const line of lines(chunk)) {
        const record = parseJsonObjectLine(line)
        if (record === undefined) rejected.push(line.slice(0, REJECTED_LINE_CHARS))
        else if (send(record)) sent += 1
      }
      return { sent, rejected }
    },
    detach: async ({ close = false } = {}) => {
      if (session.isEnded()) {
        host.close()
        return { kind: "ok" }
      }
      // Ended first, so the session's own close or release record cannot pose as the reason this stream ended.
      session.end("detached")
      const command = close ? "close_session" : "release_attachment"
      const answer = await host
        .request({ type: command, sessionId: begun.sessionId }, timeoutMs)
        .then((reply) => answerOf(reply, command), failureOf)
      host.close()
      return answer.kind === "error" ? answer : { kind: "ok" }
    },
    ended: session.ended,
  }
}

/**
 * Attaches a raw pi-RPC stream to one session on a running shared host: dials and authenticates the endpoint, opens a
 * new session or attaches to one by durable id, and answers the session's stream. It never starts a host; nothing
 * serving the endpoint is `not_running`. Every failure is answered as data.
 */
export async function attachRpcSession(options: AttachRpcSessionOptions): Promise<AttachRpcSessionResult> {
  const env = options.env ?? process.env
  const endpoint = options.socket ?? resolveTaskHostSocket(env, options.agentDir)
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  const session = createSessionRecords()
  let host: RpcSocketStream
  try {
    host = await openRpcSocketStream(endpoint, {
      keyRoot: env.SENPI_RPC_KEY_ROOT?.trim() || options.agentDir,
      onFrame: session.accept,
      onClose: () => session.end("connection_closed"),
      requestTimeoutMs: timeoutMs,
    })
  } catch (error) {
    return failureOf(error)
  }
  const begun = await begin(host, session, options.session, timeoutMs).catch(failureOf)
  if (begun.kind === "error") {
    host.close()
    return begun
  }
  // A session the host ended leaves nothing to stream, so its connection goes too: a consumer that reacts to `ended`
  // without detaching keeps no authenticated socket receiving other sessions' broadcasts.
  void session.ended.then((why) => {
    if (why === "session_closed" || why === "session_released") host.close()
  })
  session.bind(begun.sessionId)
  return { kind: "ok", stream: streamOf(host, session, begun, timeoutMs) }
}
