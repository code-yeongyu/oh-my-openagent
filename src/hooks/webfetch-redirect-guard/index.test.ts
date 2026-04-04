import { afterEach, describe, expect, it } from "bun:test"
import { createWebFetchRedirectGuardHook } from "./hook"

const originalFetch = globalThis.fetch

type FetchCall = {
  url: string
  init?: RequestInit
}

function createInput(tool = "webfetch") {
  return {
    tool,
    sessionID: "ses_test",
    callID: "call_test",
  }
}

function createBeforeOutput(url: string, format: "markdown" | "text" | "html" = "markdown") {
  return {
    args: {
      url,
      format,
    },
  }
}

function createAfterOutput(outputText: string) {
  return {
    title: "WebFetch",
    output: outputText,
    metadata: {},
  }
}

function getHeaderValue(headers: RequestInit["headers"], key: string): string | undefined {
  if (!headers) return undefined
  if (headers instanceof Headers) return headers.get(key) ?? undefined
  if (Array.isArray(headers)) {
    const match = headers.find(([name]) => name.toLowerCase() === key.toLowerCase())
    return match?.[1]
  }

  const match = Object.entries(headers).find(([name]) => name.toLowerCase() === key.toLowerCase())
  return typeof match?.[1] === "string" ? match[1] : undefined
}

function createFetchMock(
  implementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return Object.assign(implementation, {
    preconnect: Reflect.get(originalFetch, "preconnect"),
  })
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("createWebFetchRedirectGuardHook", () => {
  describe("#given the webfetch tool", () => {
    describe("#when the URL redirects once", () => {
      it("#then should replace args.url with the resolved final URL", async () => {
        const calls: FetchCall[] = []
        globalThis.fetch = createFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
          calls.push({ url: String(input), init })

          if (calls.length === 1) {
            return new Response(null, {
              status: 302,
              headers: { Location: "https://example.com/final" },
            })
          }

          return new Response("ok", { status: 200 })
        })

        const hook = createWebFetchRedirectGuardHook({} as never)
        const input = createInput()
        const output = createBeforeOutput("https://example.com/start")

        await hook["tool.execute.before"](input, output)

        expect(output.args.url).toBe("https://example.com/final")
        expect(getHeaderValue(calls[0]?.init?.headers, "accept")).toContain("text/markdown")
        expect(getHeaderValue(calls[0]?.init?.headers, "user-agent")).toContain("Mozilla/5.0")
        expect(getHeaderValue(calls[0]?.init?.headers, "accept-language")).toBe("en-US,en;q=0.9")
      })
    })

    describe("#when the redirect location is relative", () => {
      it("#then should resolve the location against the current URL", async () => {
        let callCount = 0
        globalThis.fetch = createFetchMock(async (_input: RequestInfo | URL) => {
          callCount += 1

          if (callCount === 1) {
            return new Response(null, {
              status: 301,
              headers: { Location: "/docs/final" },
            })
          }

          return new Response("ok", { status: 200 })
        })

        const hook = createWebFetchRedirectGuardHook({} as never)
        const input = createInput()
        const output = createBeforeOutput("https://example.com/docs/start")

        await hook["tool.execute.before"](input, output)

        expect(output.args.url).toBe("https://example.com/docs/final")
      })
    })

    describe("#when the redirect chain exceeds the limit", () => {
      it("#then should rewrite the raw redirect-loop error to a clear message", async () => {
        globalThis.fetch = createFetchMock(async () => {
          return new Response(null, {
            status: 302,
            headers: { Location: "/loop" },
          })
        })

        const hook = createWebFetchRedirectGuardHook({} as never)
        const input = createInput()
        const beforeOutput = createBeforeOutput("https://example.com/loop")
        const afterOutput = createAfterOutput(
          "Error: The response redirected too many times. For more information, pass `verbose: true` in the second argument to fetch()",
        )

        await hook["tool.execute.before"](input, beforeOutput)
        await hook["tool.execute.after"](input, afterOutput)

        expect(afterOutput.output).toBe(
          "Error: WebFetch failed: exceeded maximum redirects (10) for https://example.com/loop",
        )
      })
    })

    describe("#when a raw redirect-loop error arrives without tracked state", () => {
      it("#then should still normalize the message", async () => {
        const hook = createWebFetchRedirectGuardHook({} as never)
        const input = createInput()
        const output = createAfterOutput("error: too many redirects")

        await hook["tool.execute.after"](input, output)

        expect(output.output).toBe(
          "Error: WebFetch failed: exceeded maximum redirects (10)",
        )
      })
    })

    describe("#when successful fetched content mentions redirect loops", () => {
      it("#then should keep the content unchanged", async () => {
        const hook = createWebFetchRedirectGuardHook({} as never)
        const input = createInput()
        const output = createAfterOutput("This page explains why browsers hit too many redirects in some setups.")

        await hook["tool.execute.after"](input, output)

        expect(output.output).toBe(
          "This page explains why browsers hit too many redirects in some setups.",
        )
      })
    })
  })

  describe("#given a non-webfetch tool", () => {
    describe("#when the hook runs", () => {
      it("#then should leave the args untouched", async () => {
        const hook = createWebFetchRedirectGuardHook({} as never)
        const input = createInput("grep")
        const output = createBeforeOutput("https://example.com/start")

        await hook["tool.execute.before"](input, output)

        expect(output.args.url).toBe("https://example.com/start")
      })
    })
  })
})
