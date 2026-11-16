/** The engine's own startup refusal (macOS launch context); diagnostics only, never a credential. */
export type LaunchContextRefusal = "self-responsible" | "unresolved"

const MARKER = "OMO_COMPUTER_LAUNCH_REFUSED "
const MAX_RECORD_BYTES = 512

function parseRecord(line: string): LaunchContextRefusal | undefined {
  const json = line.slice(MARKER.length)
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch (error) {
    if (error instanceof SyntaxError) return undefined
    throw error
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  // JSON.parse keeps the last of duplicate keys; the wire record has exactly two.
  if (json.match(/"(?:\\.|[^"\\])*"\s*:/g)?.length !== 2 || Object.keys(value).length !== 2) return undefined
  if (Reflect.get(value, "version") !== 1) return undefined
  const reason: unknown = Reflect.get(value, "reason")
  return reason === "self-responsible" || reason === "unresolved" ? reason : undefined
}

/**
 * Reads the engine child's stderr for ONE `OMO_COMPUTER_LAUNCH_REFUSED {"version":1,"reason":...}`
 * record. The host disables it on hello (a live engine), and `finish` reports a refusal only for a
 * child that exited 1 without a signal and printed exactly one well-formed record.
 */
export class LaunchRefusalReader {
  #line = ""
  #oversized = false
  #disabled = false
  #records = 0
  #reason: LaunchContextRefusal | undefined

  disable(): void {
    this.#disabled = true
    this.#line = ""
  }

  push(chunk: string): void {
    if (this.#disabled) return
    let rest = chunk
    for (;;) {
      const end = rest.indexOf("\n")
      const part = end === -1 ? rest : rest.slice(0, end)
      this.#oversized ||= Buffer.byteLength(this.#line + part, "utf8") >= MAX_RECORD_BYTES
      this.#line += part.slice(0, Math.max(0, MAX_RECORD_BYTES - this.#line.length))
      if (end === -1) return
      this.#accept()
      rest = rest.slice(end + 1)
    }
  }

  finish(code: number | null, signal: string | null): { readonly reason: LaunchContextRefusal } | undefined {
    // A record cut off before its newline (even inside the marker) is not a refusal, whatever came before it.
    if (this.#line.startsWith(MARKER) || (this.#line !== "" && MARKER.startsWith(this.#line))) return undefined
    if (this.#disabled || code !== 1 || signal !== null || this.#records !== 1 || this.#reason === undefined)
      return undefined
    return { reason: this.#reason }
  }

  #accept(): void {
    const line = this.#line
    const oversized = this.#oversized
    this.#line = ""
    this.#oversized = false
    if (!line.startsWith(MARKER)) return
    this.#records += 1
    this.#reason = oversized ? undefined : parseRecord(line)
  }
}
