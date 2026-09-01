export interface PngChunk {
  readonly type: string
  readonly data: Buffer
  readonly crc: Buffer
}

export function readPngChunks(buffer: Buffer): PngChunk[] {
  const chunks: PngChunk[] = []
  let offset = 8

  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) {
      break
    }

    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString("ascii", offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length

    if (dataEnd + 4 > buffer.length) {
      break
    }

    const data = buffer.subarray(dataStart, dataEnd)
    const crc = buffer.subarray(dataEnd, dataEnd + 4)
    chunks.push({ type, data, crc })
    offset = dataEnd + 4
  }

  return chunks
}
