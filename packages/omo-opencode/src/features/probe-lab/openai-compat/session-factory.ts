import type { ProbeProvider, ProbeRequest } from "../providers/provider-types"

const SESSION_CREATE_PATH = "/api/v0/chat_session/create"
const SESSION_TIMEOUT_MS = 30_000

export type CreateChatSessionInput = {
  provider: ProbeProvider
  baseUrl: string
  requestId: string
}

export type CreateChatSessionResult =
  | { ok: true; id: string }
  | { ok: false; reason: string; httpStatus?: number }

export async function createChatSession(
  input: CreateChatSessionInput,
): Promise<CreateChatSessionResult> {
  const url = `${input.baseUrl.replace(/\/$/, "")}${SESSION_CREATE_PATH}`
  const req: ProbeRequest = {
    url,
    method: "POST",
    headers: {},
    body: JSON.stringify({ agent: "chat" }),
    timeout_ms: SESSION_TIMEOUT_MS,
    forward_as_is: false,
    metadata: { session_id: `oai-sess-${input.requestId}`, exchange_sequence: 1 },
  }
  const res = await input.provider.dispatchProbe(req)
  if (res.status !== 200) {
    return {
      ok: false,
      reason: `chat_session/create returned HTTP ${res.status}`,
      httpStatus: res.status,
    }
  }
  const id = parseSessionId(res.body)
  if (!id) {
    return { ok: false, reason: "chat_session/create response missing data.biz_data.id" }
  }
  return { ok: true, id }
}

function parseSessionId(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as {
      data?: {
        biz_data?: {
          id?: unknown
          chat_session?: { id?: unknown }
        }
      }
    }
    const nested = parsed?.data?.biz_data?.chat_session?.id
    if (typeof nested === "string" && nested.length > 0) return nested
    const flat = parsed?.data?.biz_data?.id
    if (typeof flat === "string" && flat.length > 0) return flat
    return null
  } catch {
    return null
  }
}
