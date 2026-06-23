import { afterEach, describe, expect, test } from "bun:test"
import { createAntiCaptchaTask, pollAntiCaptchaTaskResult, getAntiCaptchaBalance } from "./anti-captcha-client"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("createAntiCaptchaTask", () => {
  test("#given hCaptcha proxyless task #when createTask posts to api.anti-captcha.com #then forwards clientKey + task verbatim", async () => {
    let postedUrl: string | undefined
    let postedBody: unknown
    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      postedUrl = String(url)
      postedBody = JSON.parse(String(init?.body))
      return Response.json({ errorId: 0, taskId: 971199698 })
    }

    const taskId = await createAntiCaptchaTask({
      apiKey: "anti-captcha-key",
      type: "HCaptchaTask",
      websiteURL: "https://elevenlabs.io/sign-up",
      websiteKey: "3aad1500-7e79-4051-aac5-6852324dab76",
      isInvisible: true,
      userAgent: "Mozilla/5.0 chrome-148",
    })

    expect(postedUrl).toBe("https://api.anti-captcha.com/createTask")
    expect(postedBody).toEqual({
      clientKey: "anti-captcha-key",
      task: {
        type: "HCaptchaTask",
        websiteURL: "https://elevenlabs.io/sign-up",
        websiteKey: "3aad1500-7e79-4051-aac5-6852324dab76",
        isInvisible: true,
        userAgent: "Mozilla/5.0 chrome-148",
      },
    })
    expect(taskId).toBe("971199698")
  })

  test("#given enterprise hCaptcha #when createTask called #then includes enterprisePayload", async () => {
    let postedBody: unknown
    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      postedBody = JSON.parse(String(init?.body))
      return Response.json({ errorId: 0, taskId: "task-456" })
    }

    await createAntiCaptchaTask({
      apiKey: "k",
      type: "HCaptchaEnterpriseTask",
      websiteURL: "https://example.com",
      websiteKey: "site-key",
      enterprisePayload: { rqdata: "rq-value", sentry: true },
      userAgent: "ua",
    })

    expect(postedBody).toMatchObject({
      task: {
        enterprisePayload: { rqdata: "rq-value", sentry: true },
      },
    })
  })

  test("#given proxyUrl provided #when createTask called #then forwards proxy option to fetch", async () => {
    let initOpts: RequestInit | undefined
    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      initOpts = init
      return Response.json({ errorId: 0, taskId: "tid" })
    }

    await createAntiCaptchaTask({
      apiKey: "k",
      type: "HCaptchaTask",
      websiteURL: "https://example.com",
      websiteKey: "sk",
      proxyUrl: "http://user:pass@pr.oxylabs.io:7777",
    })

    expect((initOpts as { proxy?: string } | undefined)?.proxy).toBe("http://user:pass@pr.oxylabs.io:7777")
  })

  test("#given errorId non-zero #when createTask called #then throws with code and description", async () => {
    globalThis.fetch = async () => Response.json({
      errorId: 23,
      errorCode: "ERROR_KEY_DOES_NOT_EXIST",
      errorDescription: "Account auth key not found",
    })

    await expect(
      createAntiCaptchaTask({
        apiKey: "bad",
        type: "HCaptchaTask",
        websiteURL: "https://x.com",
        websiteKey: "sk",
      }),
    ).rejects.toThrow(/ERROR_KEY_DOES_NOT_EXIST/)
  })
})

describe("pollAntiCaptchaTaskResult", () => {
  test("#given task ready #when polling #then returns solution token", async () => {
    let polls = 0
    globalThis.fetch = async () => {
      polls += 1
      if (polls < 2) return Response.json({ errorId: 0, status: "processing" })
      return Response.json({
        errorId: 0,
        status: "ready",
        solution: { gRecaptchaResponse: "token-abc" },
        cost: "0.002",
      })
    }

    const solution = await pollAntiCaptchaTaskResult({
      apiKey: "k",
      taskId: "971199698",
      pollIntervalMs: 1,
      timeoutMs: 5_000,
    })

    expect(solution?.gRecaptchaResponse).toBe("token-abc")
    expect(polls).toBeGreaterThanOrEqual(2)
  })

  test("#given errorId non-zero in poll #when polling #then throws", async () => {
    globalThis.fetch = async () => Response.json({
      errorId: 13,
      errorCode: "ERROR_NO_SUCH_CAPCHA_ID",
      errorDescription: "Task not found",
    })

    await expect(
      pollAntiCaptchaTaskResult({ apiKey: "k", taskId: "tid", pollIntervalMs: 1, timeoutMs: 100 }),
    ).rejects.toThrow(/ERROR_NO_SUCH_CAPCHA_ID/)
  })

  test("#given timeout exceeded #when polling never ready #then throws timeout", async () => {
    globalThis.fetch = async () => Response.json({ errorId: 0, status: "processing" })

    await expect(
      pollAntiCaptchaTaskResult({ apiKey: "k", taskId: "tid", pollIntervalMs: 5, timeoutMs: 30 }),
    ).rejects.toThrow(/timeout/)
  })
})

describe("getAntiCaptchaBalance", () => {
  test("#given valid key #when getBalance called #then returns balance number", async () => {
    let postedBody: unknown
    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      postedBody = JSON.parse(String(init?.body))
      return Response.json({ errorId: 0, balance: 9.929 })
    }

    const balance = await getAntiCaptchaBalance({ apiKey: "k" })

    expect(balance).toBe(9.929)
    expect(postedBody).toEqual({ clientKey: "k" })
  })

  test("#given errorId non-zero #when getBalance called #then throws", async () => {
    globalThis.fetch = async () => Response.json({
      errorId: 1,
      errorCode: "ERROR_KEY_DOES_NOT_EXIST",
    })

    await expect(getAntiCaptchaBalance({ apiKey: "bad" })).rejects.toThrow(/ERROR_KEY_DOES_NOT_EXIST/)
  })
})
