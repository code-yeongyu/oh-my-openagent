import { afterEach, describe, expect, test } from "bun:test"
import { createTask } from "./capsolver-client"

const originalFetch = globalThis.fetch

describe("createTask", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("#given enterprise captcha fields #when createTask posts task #then forwards fields verbatim", async () => {
    let postedBody: unknown
    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      postedBody = JSON.parse(String(init?.body))
      return Response.json({ errorId: 0, taskId: "task-123" })
    }

    await createTask({
      apiKey: "capsolver-key",
      type: "HCaptchaTask",
      websiteURL: "https://example.com/signup",
      websiteKey: "site-key",
      enterprisePayload: { rqdata: "rqdata-value" },
      isInvisible: true,
      userAgent: "Mozilla/5.0 test",
    })

    expect(postedBody).toEqual({
      clientKey: "capsolver-key",
      task: {
        type: "HCaptchaTask",
        websiteURL: "https://example.com/signup",
        websiteKey: "site-key",
        enterprisePayload: { rqdata: "rqdata-value" },
        isInvisible: true,
        userAgent: "Mozilla/5.0 test",
      },
    })
  })
})
