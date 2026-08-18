import { closeSync, fstatSync, openSync, readSync } from "node:fs"

export const MAX_TRANSCRIPT_SOURCE_BYTES = 1_000_000

export type BoundedFileText = {
  readonly text: string
  readonly truncated: boolean
}

export function readBoundedFileText(
  path: string,
  maximumBytes = MAX_TRANSCRIPT_SOURCE_BYTES,
): BoundedFileText | undefined {
  let descriptor: number | undefined
  try {
    descriptor = openSync(path, "r")
    const size = fstatSync(descriptor).size
    if (size <= maximumBytes) {
      const buffer = Buffer.alloc(size)
      readSync(descriptor, buffer, 0, size, 0)
      return { text: buffer.toString("utf8"), truncated: false }
    }

    const headBytes = Math.floor((maximumBytes - 1) / 2)
    const tailBytes = maximumBytes - headBytes - 1
    const buffer = Buffer.alloc(maximumBytes)
    readSync(descriptor, buffer, 0, headBytes, 0)
    buffer[headBytes] = 0x0a
    readSync(descriptor, buffer, headBytes + 1, tailBytes, size - tailBytes)
    return { text: buffer.toString("utf8"), truncated: true }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
    throw error
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}
