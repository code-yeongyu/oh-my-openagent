export interface PngIhdr {
  readonly width: number
  readonly height: number
  readonly bitDepth: number
  readonly colorType: number
  readonly compressionMethod: number
  readonly filterMethod: number
  readonly interlaceMethod: number
}

export function parseIhdr(data: Buffer): PngIhdr | null {
  if (data.length < 13) {
    return null
  }

  const width = data.readUInt32BE(0)
  const height = data.readUInt32BE(4)
  const compressionMethod = data[10]
  const filterMethod = data[11]
  const interlaceMethod = data[12]

  if (width === 0 || height === 0 || compressionMethod !== 0 || filterMethod !== 0 || interlaceMethod !== 0) {
    return null
  }

  return {
    width,
    height,
    bitDepth: data[8],
    colorType: data[9],
    compressionMethod,
    filterMethod,
    interlaceMethod,
  }
}

export function getBytesPerPixel(colorType: number, bitDepth: number): number | null {
  const channels: Record<number, number> = {
    0: 1,
    2: 3,
    4: 2,
    6: 4,
  }

  const channelCount = channels[colorType]
  if (channelCount === undefined) {
    return null
  }

  return channelCount * (bitDepth / 8)
}
