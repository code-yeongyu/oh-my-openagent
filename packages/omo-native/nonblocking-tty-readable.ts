import { readSync } from "node:fs"
import { Readable } from "node:stream"

const isWouldBlock = (error: unknown): boolean =>
  error instanceof Error && "code" in error && (error.code === "EAGAIN" || error.code === "EWOULDBLOCK")

/**
 * A readable over a terminal descriptor opened with O_NONBLOCK. #13696 needs a reader that leaves no read in flight
 * once destroyed, so the command exits without another key; `Bun.file(fd).stream()` gave that on Linux but on darwin
 * it fails at once with `EINVAL ... kqueue` (kqueue refuses the tty descriptor), which cancelled every phrase prompt.
 * Here each read is a synchronous `readSync` that returns at once: EAGAIN means "no key yet" and is retried after
 * `retryMs`; destroying the stream clears the pending retry, so nothing keeps the process alive.
 */
export function nonBlockingTtyReadable(fd: number, retryMs = 20): Readable {
  const chunk = Buffer.alloc(256)
  let retry: ReturnType<typeof setTimeout> | undefined
  // A Readable stays "reading" until something is pushed, so `read(0)` would not call `read()` again after EAGAIN:
  // the retry calls `pull` itself.
  const pull = (): void => {
    retry = undefined
    let count: number
    try {
      count = readSync(fd, chunk, 0, chunk.length, null)
    } catch (error) {
      if (isWouldBlock(error)) retry = setTimeout(pull, retryMs)
      else stream.destroy(error instanceof Error ? error : new Error(String(error)))
      return
    }
    stream.push(count === 0 ? null : Buffer.from(chunk.subarray(0, count)))
  }
  const stream: Readable = new Readable({
    read() {
      if (retry === undefined) pull()
    },
    destroy(error, callback) {
      if (retry !== undefined) clearTimeout(retry)
      retry = undefined
      // The last bytes typed may be recovery-phrase words: leave none in the reused buffer (#14098).
      chunk.fill(0)
      callback(error)
    },
  })
  return stream
}
