import type { Page, Request as PwRequest, Response as PwResponse } from "playwright-core"

export type CapturedRequest = {
  url: string
  method: string
  resourceType: string
  status?: number
  contentType?: string
  requestBody?: string
  responseBody?: string
  timestamp: number
}

export type NetworkTapOptions = {
  captureBodies?: boolean
}

const REQUEST_BODY_LIMIT = 16 * 1024
const RESPONSE_BODY_LIMIT = 32 * 1024

export function createNetworkTap(page: Page, opts: NetworkTapOptions = {}) {
  const captured: CapturedRequest[] = []
  let listening = false
  let captureBodies = opts.captureBodies ?? false

  function start(): void {
    if (listening) return
    listening = true

    page.on("request", (req: PwRequest) => {
      const entry: CapturedRequest = {
        url: req.url(),
        method: req.method(),
        resourceType: req.resourceType(),
        timestamp: Date.now(),
      }
      if (captureBodies) entry.requestBody = cap(req.postData(), REQUEST_BODY_LIMIT)
      captured.push(entry)
    })

    page.on("response", async (resp: PwResponse) => {
      const entry = captured.find(r => r.url === resp.url() && !r.status)
      if (entry) {
        entry.status = resp.status()
        entry.contentType = resp.headers()["content-type"]
        if (captureBodies) entry.responseBody = cap(await resp.text().catch(() => null), RESPONSE_BODY_LIMIT)
      }
    })
  }

  function getAll(): CapturedRequest[] {
    return [...captured]
  }

  function getByType(resourceType: string): CapturedRequest[] {
    return captured.filter(r => r.resourceType === resourceType)
  }

  function getApiCalls(): CapturedRequest[] {
    return captured.filter(r =>
      r.resourceType === "xhr" || r.resourceType === "fetch"
    )
  }

  function clear(): void {
    captured.length = 0
  }

  function setBodyCapture(enabled: boolean): void {
    captureBodies = enabled
  }

  return { start, getAll, getByType, getApiCalls, clear, setBodyCapture }
}

function cap(value: string | null, maxBytes: number): string | undefined {
  if (value === null) return undefined
  return value.length > maxBytes ? value.slice(0, maxBytes) : value
}

export type NetworkTap = ReturnType<typeof createNetworkTap>
