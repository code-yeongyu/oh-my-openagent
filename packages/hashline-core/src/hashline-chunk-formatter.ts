export interface HashlineChunkFormatter {
  push(formattedLine: string): string[]
  flush(): string | undefined
}

interface HashlineChunkFormatterOptions {
  maxChunkLines: number
  maxChunkBytes: number
}

export function createHashlineChunkFormatter(options: HashlineChunkFormatterOptions): HashlineChunkFormatter {
  const { maxChunkLines, maxChunkBytes } = options
  let outputLines: string[] = []
  let outputBytes = 0

  const flush = (): string | undefined => {
    if (outputLines.length === 0) return undefined
    const chunk = outputLines.join("\n")
    outputLines = []
    outputBytes = 0
    return chunk
  }

  const push = (formattedLine: string): string[] => {
    const chunksToYield: string[] = []
    const separatorBytes = outputLines.length === 0 ? 0 : 1
    const lineBytes = Buffer.byteLength(formattedLine, "utf-8")

    if (
      outputLines.length > 0 &&
      (outputLines.length >= maxChunkLines || outputBytes + separatorBytes + lineBytes > maxChunkBytes)
    ) {
      const flushed = flush()
      if (flushed) chunksToYield.push(flushed)
    }

    outputLines.push(formattedLine)
    outputBytes += (outputLines.length === 1 ? 0 : 1) + lineBytes

    if (outputLines.length >= maxChunkLines || outputBytes >= maxChunkBytes) {
      const flushed = flush()
      if (flushed) chunksToYield.push(flushed)
    }

    return chunksToYield
  }

  return {
    push,
    flush,
  }
}
