export interface PngIhdr {
  readonly width: number
  readonly height: number
  readonly bitDepth: number
  readonly colorType: number
}

export function parseIhdr(data: Buffer): PngIhdr | null {
  if (data.length < 13) {
    return null
  }

  return {
    width: data.readUInt32BE(0),
    height: data.readUInt32BE(4),
    bitDepth: data[8],
    colorType: data[9],
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
