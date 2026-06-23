import { describe, expect, test } from "bun:test"
import type { Page, Request as PwRequest, Response as PwResponse } from "playwright-core"
import { createNetworkTap } from "./network-tap"

describe("createNetworkTap", () => {
  test("#given body capture disabled #when request and response are captured #then bodies are omitted", async () => {
    const page = createEventPage()
    const tap = createNetworkTap(page)
    tap.start()

    await page.emitRequest(createRequest("payload=secret"))
    await page.emitResponse(createResponse("response body"))

    expect(tap.getAll()[0]).not.toHaveProperty("requestBody")
    expect(tap.getAll()[0]).not.toHaveProperty("responseBody")
  })

  test("#given body capture enabled #when request and response are captured #then capped bodies are stored", async () => {
    const page = createEventPage()
    const tap = createNetworkTap(page, { captureBodies: true })
    tap.start()

    await page.emitRequest(createRequest("payload=secret"))
    await page.emitResponse(createResponse("response body"))

    expect(tap.getAll()[0]).toMatchObject({ requestBody: "payload=secret", responseBody: "response body" })
  })
})

type EventPage = Page & {
  emitRequest(req: PwRequest): Promise<void>
  emitResponse(resp: PwResponse): Promise<void>
}

function createEventPage(): EventPage {
  const handlers: Record<string, Array<(value: unknown) => void | Promise<void>>> = {}
  return {
    on: (event: string, handler: (value: unknown) => void | Promise<void>) => {
      handlers[event] = [...(handlers[event] ?? []), handler]
      return undefined as unknown as Page
    },
    emitRequest: async (req: PwRequest) => {
      for (const handler of handlers.request ?? []) await handler(req)
    },
    emitResponse: async (resp: PwResponse) => {
      for (const handler of handlers.response ?? []) await handler(resp)
    },
  } as EventPage
}

function createRequest(body: string): PwRequest {
  return {
    url: () => "https://example.com/api",
    method: () => "POST",
    resourceType: () => "fetch",
    postData: () => body,
  } as PwRequest
}

function createResponse(body: string): PwResponse {
  return {
    url: () => "https://example.com/api",
    status: () => 200,
    headers: () => ({ "content-type": "application/json" }),
    text: async () => body,
  } as PwResponse
}
