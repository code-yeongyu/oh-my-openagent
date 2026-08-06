import { afterEach, describe, expect, test } from "bun:test"

import {
  _setFetchImplementationForTesting,
  initLiveServerRoute,
  resetLiveServerRouteForTesting,
  resolveDispatchClient,
} from "./live-server-route"

describe("live-server-route probe endpoint", () => {
  afterEach(() => {
    resetLiveServerRouteForTesting()
  })

  test("#given live server route is registered #when availability is probed #then the stable health endpoint is used", async () => {
    //#given
    const fetchedUrls: string[] = []
    const fakeFetch: typeof fetch = async (input) => {
      fetchedUrls.push(String(input))
      return new Response(JSON.stringify({ healthy: true }), { status: 200 })
    }
    const inProcessClient = { marker: "in-process" }
    _setFetchImplementationForTesting(fakeFetch)
    initLiveServerRoute({
      serverUrl: new URL("http://127.0.0.1:4096"),
      directory: "/tmp/live-probe",
      inProcessClient,
    })

    //#when
    await resolveDispatchClient(inProcessClient, "ses_probe_endpoint")

    //#then — health probe first, then per-session affinity verification (#5569)
    expect(fetchedUrls).toEqual([
      "http://127.0.0.1:4096/global/health",
      "http://127.0.0.1:4096/session/ses_probe_endpoint",
    ])
  })
})
