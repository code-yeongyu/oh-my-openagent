export type SseEvent = {
  event?: string
  data: string
}

export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent, void, void> {
  const decoder = new TextDecoder("utf-8")
  const reader = stream.getReader()
  let buffer = ""
  let pendingEvent: string | undefined
  let pendingData: string[] = []

  const flushEvent = (): SseEvent | null => {
    if (pendingData.length === 0 && pendingEvent === undefined) return null
    const ev: SseEvent = { data: pendingData.join("\n") }
    if (pendingEvent !== undefined) ev.event = pendingEvent
    pendingEvent = undefined
    pendingData = []
    return ev
  }

  const consumeLine = (rawLine: string): SseEvent | null => {
    const line = rawLine.replace(/\r$/, "")
    if (line.length === 0) return flushEvent()
    if (line.startsWith(":")) return null
    if (line.startsWith("event:")) {
      pendingEvent = line.slice(6).trim()
      return null
    }
    if (line.startsWith("data:")) {
      pendingData.push(line.slice(5).replace(/^ /, ""))
      return null
    }
    return null
  }

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      for (const rawLine of lines) {
        const ev = consumeLine(rawLine)
        if (ev) yield ev
      }
    }
    buffer += decoder.decode()
    if (buffer.length > 0) {
      const ev = consumeLine(buffer)
      if (ev) yield ev
    }
    const final = flushEvent()
    if (final) yield final
  } finally {
    try {
      reader.releaseLock()
    } catch {
      void 0
    }
  }
}
