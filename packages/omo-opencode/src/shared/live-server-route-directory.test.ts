import { afterEach, describe, expect, test } from "bun:test"
import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"
import {
  _setFetchImplementationForTesting,
  initLiveServerRoute,
  resetLiveServerRouteForTesting,
  resolveDispatchClient,
} from "./live-server-route"

const SERVER_URL = new URL("http://127.0.0.1:19999")

afterEach(() => {
  resetLiveServerRouteForTesting()
})

describe("live server route directory context", () => {
  test("#given generated live client #when session status is requested #then registered directory reaches the listener", async () => {
    //#given
    const seenUrls: string[] = []
    const fakeFetch: typeof fetch = async (input) => {
      const url = input instanceof Request ? input.url : String(input)
      seenUrls.push(url)
      if (url.includes("/global/health") || url.includes("/session/ses_directory")) {
        return new Response("{}", { status: 200 })
      }
      return Response.json({})
    }
    _setFetchImplementationForTesting(fakeFetch)
    const originalFetch = globalThis.fetch
    globalThis.fetch = fakeFetch
    const inProcessClient = {}
    initLiveServerRoute({
      serverUrl: SERVER_URL,
      directory: "/tmp/project with spaces",
      inProcessClient,
    })

    try {
      //#when
      const result = await resolveDispatchClient(inProcessClient, "ses_directory")
      const client = unsafeTestValue<{ session: { status: () => Promise<unknown> } }>(result.client)
      await client.session.status()

      //#then
      const statusUrl = seenUrls.find((url) => url.includes("/session/status"))
      expect(statusUrl).toBeDefined()
      expect(new URL(statusUrl ?? SERVER_URL).searchParams.get("directory")).toBe("/tmp/project with spaces")
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
