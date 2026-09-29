export type ProviderRequest = {
  bytes: Uint8Array
  filename: string
  key: string
  baseUrl: string
  fetch: typeof fetch
  pollIntervalMs: number
  timeoutMs: number
}

type Json = Record<string, unknown>

function isJson(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function call(request: ProviderRequest, path: string, init: RequestInit = {}): Promise<Json> {
  const response = await request.fetch(`${request.baseUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${request.key}`, ...init.headers },
  })
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} returned ${response.status}`)
  const body: unknown = await response.json()
  if (!isJson(body)) throw new Error(`${path} returned a non-object body`)
  return body
}

function stringField(body: Json, field: string, what: string): string {
  const value = body[field]
  if (typeof value !== "string" || value === "") throw new Error(`${what}: no ${field}`)
  return value
}

const pause = (ms: number) => (ms <= 0 ? Promise.resolve() : new Promise<void>((resolve) => setTimeout(resolve, ms)))

/** Soniox async transcription: upload, start, wait for completion, fetch the transcript, delete the upload. */
export async function sonioxTranscribe(request: ProviderRequest): Promise<string> {
  const form = new FormData()
  form.append("file", new Blob([request.bytes]), request.filename)
  const fileId = stringField(await call(request, "/files", { method: "POST", body: form }), "id", "upload")
  try {
    const started = await call(request, "/transcriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "stt-async-v5", file_id: fileId, language_hints: ["ko", "en"], enable_language_identification: true }),
    })
    const jobId = stringField(started, "id", "transcription")
    const deadline = Date.now() + request.timeoutMs
    for (;;) {
      const status = await call(request, `/transcriptions/${jobId}`)
      if (status.status === "completed") break
      if (status.status === "error") throw new Error(`transcription error: ${String(status.error_message ?? "unknown")}`)
      if (Date.now() >= deadline) throw new Error("transcription timed out")
      await pause(request.pollIntervalMs)
    }
    return stringField(await call(request, `/transcriptions/${jobId}/transcript`), "text", "transcript").trim()
  } finally {
    await call(request, `/files/${fileId}`, { method: "DELETE" }).catch(() => undefined)
  }
}
