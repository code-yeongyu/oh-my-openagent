// JSON lines over a byte stream, shared by the relay parity sweep's live legs and their driver
// (script/qa/rpc-relay-parity-live.ts): one JSON object per LF-terminated line.

export type JsonRecord = Record<string, unknown>

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** Calls `onRecord` with every JSON object line of `stream` until it ends; other lines are ignored. */
export async function readRecords(
  stream: ReadableStream<Uint8Array>,
  onRecord: (record: JsonRecord) => void,
): Promise<void> {
  const decoder = new TextDecoder()
  let buffer = ""
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true })
    let newline = buffer.indexOf("\n")
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf("\n")
      if (line === "") continue
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        continue
      }
      if (isRecord(parsed)) onRecord(parsed)
    }
  }
}

/**
 * A leg's command loop: reads one request per stdin line, answers each with `handle`'s result on stdout as
 * `{ seq, ok: true, ...result }` or `{ seq, ok: false, error }`. Requests are handled one at a time, in order.
 */
export async function serveLeg(handle: (request: JsonRecord) => Promise<JsonRecord>): Promise<void> {
  let chain = Promise.resolve()
  await readRecords(Bun.stdin.stream(), (request) => {
    chain = chain.then(async () => {
      const seq = request["seq"]
      try {
        process.stdout.write(`${JSON.stringify({ seq, ok: true, ...(await handle(request)) })}\n`)
      } catch (error) {
        process.stdout.write(`${JSON.stringify({ seq, ok: false, error: String(error) })}\n`)
      }
    })
  })
  await chain
}
