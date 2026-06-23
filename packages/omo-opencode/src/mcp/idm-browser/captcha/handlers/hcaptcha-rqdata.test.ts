import { describe, expect, test } from "bun:test"
import type { Page, Request as PwRequest } from "playwright-core"
import { extractHCaptchaRqdata } from "./hcaptcha-rqdata"

describe("extractHCaptchaRqdata", () => {
  test("#given getcaptcha request with form body #when extracting rqdata #then returns decoded rqdata", async () => {
    const page = createRqdataPage({ requestBody: "v=1&rqdata=encoded%20rqdata&sitekey=abc" })

    const rqdata = await extractHCaptchaRqdata(page, { timeoutMs: 10 })

    expect(rqdata).toBe("encoded rqdata")
  })
})

type RqdataPageOptions = {
  requestBody?: string
}

function createRqdataPage(opts: RqdataPageOptions): Page {
  return {
    waitForRequest: async (predicate: (request: PwRequest) => boolean) => {
      const request = {
        url: () => "https://api.hcaptcha.com/getcaptcha/3aad1500-7e79-4051-aac5-6852324dab76",
        postData: () => opts.requestBody ?? null,
      } as PwRequest
      if (!predicate(request)) throw new Error("request did not match")
      return request
    },
    evaluate: async () => null,
  } as unknown as Page
}
