function formatTimestamp(date: Date): string {
  const hh = String(date.getHours()).padStart(2, "0")
  const mm = String(date.getMinutes()).padStart(2, "0")
  const ss = String(date.getSeconds()).padStart(2, "0")
  return `${hh}:${mm}:${ss}`
}

export function createTimestampTransformer(now: () => Date = () => new Date()): (chunk: string) => string {
  let atLineStart = true

  return (chunk: string): string => {
    if (!chunk) return ""

    let output = ""
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i]
      if (atLineStart) {
        output += `[${formatTimestamp(now())}] `
        atLineStart = false
      }

      output += ch

      if (ch === "\n") {
        atLineStart = true
      }
    }

    return output
  }
}

type WriteFn = NodeJS.WriteStream["write"]

export function createTimestampedStdoutController(stdout: NodeJS.WriteStream = process.stdout): {
  enable: () => void
  restore: () => void
} {
  const originalWrite = stdout.write.bind(stdout)
  const transform = createTimestampTransformer()

  function enable(): void {
    const write: WriteFn = (
      chunk: Uint8Array | string,
      encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
      callback?: (error?: Error | null) => void,
    ): boolean => {
      const text = typeof chunk === "string"
        ? chunk
        : Buffer.from(chunk).toString(typeof encodingOrCallback === "string" ? encodingOrCallback : undefined)
      const stamped = transform(text)

      if (typeof encodingOrCallback === "function") {
        return originalWrite(stamped, encodingOrCallback)
      }
      if (encodingOrCallback !== undefined) {
        return originalWrite(stamped, encodingOrCallback, callback)
      }
      return originalWrite(stamped)
    }

    stdout.write = write
  }

  function restore(): void {
    stdout.write = originalWrite
  }

  return { enable, restore }
}
