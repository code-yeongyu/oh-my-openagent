import { describe, expect, test } from "bun:test"
import { announce } from "./release-announce"

describe("release announcement probe", () => {
  test.each([
    { post: 200, remove: 204, verify: 404, result: "probe" },
    { post: 500, remove: 204, verify: 404, result: "POST returned HTTP 500" },
    { post: 200, remove: 403, verify: 404, result: "DELETE returned HTTP 403" },
    { post: 200, remove: 204, verify: 200, result: "expected 404" },
    { post: 200, remove: 204, verify: 500, result: "expected 404" },
  ])("#given probe responses %p #when run #then every transition must succeed", async ({ post, remove, verify, result }) => {
    const webhook = "https://discord.com/api/webhooks/123/dummy?wait=false"
    const calls: { url: string; init: RequestInit | undefined }[] = []
    const responses = [
      Response.json({ tag_name: "v5.1.29", body: "**Fixed.** Details.", draft: false, prerelease: false }),
      Response.json({ id: "456" }, { status: post }),
      new Response(null, { status: remove }),
      new Response(null, { status: verify }),
    ]
    const run = announce({
      tag: "v5.1.29", event: "workflow_dispatch", webhook, dryRun: false, probe: true,
    }, async (url, init) => {
      calls.push({ url, init })
      const response = responses.shift()
      if (!response) throw new Error("Unexpected request")
      return response
    })
    if (result === "probe") {
      expect(await run).toBe("probe")
      expect(calls.map((call) => call.init?.method)).toEqual(["GET", "POST", "DELETE", "GET"])
      expect(calls[2]?.url).toBe("https://discord.com/api/webhooks/123/dummy/messages/456")
      expect(calls[3]?.url).toBe(calls[2]?.url)
    } else {
      await expect(run).rejects.toThrow(result)
      expect(calls).toHaveLength(post !== 200 ? 2 : remove !== 204 ? 3 : 4)
    }
    const payload = JSON.parse(String(calls[1]?.init?.body))
    expect(payload).toEqual({
      content: "Release announcement pipeline check for v5.1.29; this message deletes itself.",
      allowed_mentions: { parse: [] },
    })
    expect(calls[1]?.url).toBe("https://discord.com/api/webhooks/123/dummy?wait=true")
  })
})
