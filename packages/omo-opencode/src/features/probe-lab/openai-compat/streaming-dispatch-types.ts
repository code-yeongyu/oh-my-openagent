export type StreamingDispatchResult =
  | {
      ok: true
      status: number
      headers: Record<string, string>
      body: ReadableStream<Uint8Array>
    }
  | { ok: false; status: number; bodyText: string; reason: string }
