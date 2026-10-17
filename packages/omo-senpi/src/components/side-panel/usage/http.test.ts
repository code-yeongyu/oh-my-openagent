import { describe, expect, test } from "bun:test"

import { createUsageFetch, parseRetryAfterMs } from "./http"

describe("parseRetryAfterMs", () => {
  test("#given numeric seconds #when parsed #then the delay is returned in milliseconds", () => {
    // given / when / then
    expect(parseRetryAfterMs("120", 1_700_000_000_000)).toBe(120_000)
  })

  test("#given an HTTP date #when parsed #then the delay is measured from now", () => {
    // given
    const now = Date.parse("2023-11-14T22:00:00Z")

    // when / then
    expect(parseRetryAfterMs("Tue, 14 Nov 2023 22:02:00 GMT", now)).toBe(120_000)
  })

  test("#given a past or invalid value #when parsed #then no retry delay is invented", () => {
    // given
    const now = Date.parse("2023-11-14T22:00:00Z")

    // when / then
    expect(parseRetryAfterMs("Tue, 14 Nov 2023 21:59:00 GMT", now)).toBeUndefined()
    expect(parseRetryAfterMs("later", now)).toBeUndefined()
  })
})

describe("createUsageFetch", () => {
  test("#given a usage endpoint that redirects #when fetched #then the request fails and the token never follows", async () => {
    // given: a login wall or captive portal answering with a redirect
    const seen: string[] = []
    const target = Bun.serve({
      port: 0,
      fetch: (request) => {
        seen.push(request.headers.get("authorization") ?? "")
        return Response.json({})
      },
    })
    const origin = Bun.serve({
      port: 0,
      fetch: () => new Response(null, { status: 302, headers: { location: target.url.href } }),
    })
    try {
      // when
      const outcome = await createUsageFetch()(origin.url.href, { authorization: "Bearer secret" }).then(
        () => "resolved",
        () => "rejected",
      )

      // then
      expect(outcome).toBe("rejected")
      expect(seen).toEqual([])
    } finally {
      origin.stop(true)
      target.stop(true)
    }
  })
})
