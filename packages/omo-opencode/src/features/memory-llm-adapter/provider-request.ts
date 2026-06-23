import type { ClaudeMemLlmAdapterFetch } from "./types"

export type ProviderResponse = {
  ok: boolean
  status: number
  contentType: string | null
  text: string
}

export class ProviderRequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`provider request timed out after ${timeoutMs}ms`)
    this.name = "ProviderRequestTimeoutError"
  }
}

export async function fetchProviderResponse(
  fetchImpl: ClaudeMemLlmAdapterFetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<ProviderResponse> {
  const controller = new AbortController()
  const timeoutError = new ProviderRequestTimeoutError(timeoutMs)
  let response: Response | undefined
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  const operation = async (): Promise<ProviderResponse> => {
    response = await fetchImpl(url, { ...init, signal: controller.signal })
    return {
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get("content-type"),
      text: await response.text(),
    }
  }

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort(timeoutError)
      void response?.body?.cancel(timeoutError).catch(() => undefined)
      reject(timeoutError)
    }, timeoutMs)
  })

  try {
    return await Promise.race([operation(), timeoutPromise])
  } catch (err) {
    if (controller.signal.aborted) {
      const reason = controller.signal.reason
      if (reason instanceof Error) {
        throw reason
      }
      throw new ProviderRequestTimeoutError(timeoutMs)
    }
    throw err
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}
