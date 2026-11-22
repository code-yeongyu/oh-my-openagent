import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js"

type RequestId = string | number

interface OutgoingMessage {
  id?: unknown
  method?: unknown
  params?: { requestId?: unknown }
}

function isRequestId(value: unknown): value is RequestId {
  return typeof value === "string" || typeof value === "number"
}

function releaseWhenBodyEnds(body: ReadableStream<Uint8Array>, release: () => void): ReadableStream<Uint8Array> {
  const reader = body.getReader()
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          release()
          controller.close()
          return
        }
        controller.enqueue(value)
      } catch (error) {
        release()
        throw error
      }
    },
    cancel(reason) {
      release()
      return reader.cancel(reason)
    },
  })
}

// The SDK fetches every POST with one transport-wide signal, so cancelling a request
// (notifications/cancelled, sent on caller abort or request timeout) leaves its HTTP
// request and SSE stream open. Give each request its own signal and abort it on cancel.
export function createRequestAbortFetch(fetchImpl: FetchLike): FetchLike {
  const inFlight = new Map<RequestId, AbortController>()
  return async (input, init) => {
    if (typeof init?.body !== "string") return fetchImpl(input, init)
    const message: OutgoingMessage = JSON.parse(init.body)
    const cancelledId = message.params?.requestId
    if (message.method === "notifications/cancelled" && isRequestId(cancelledId)) {
      inFlight.get(cancelledId)?.abort()
      inFlight.delete(cancelledId)
    }
    if (typeof message.method !== "string" || !isRequestId(message.id)) return fetchImpl(input, init)

    const id = message.id
    const controller = new AbortController()
    inFlight.set(id, controller)
    const release = () => {
      if (inFlight.get(id) === controller) inFlight.delete(id)
    }
    const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal
    let response: Response
    try {
      response = await fetchImpl(input, { ...init, signal })
    } catch (error) {
      release()
      throw error
    }
    // Non-2xx responses keep their identity: the SDK reads url/type/redirect fields from them.
    if (!response.ok || !response.body) {
      release()
      return response
    }
    return new Response(releaseWhenBodyEnds(response.body, release), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }
}
