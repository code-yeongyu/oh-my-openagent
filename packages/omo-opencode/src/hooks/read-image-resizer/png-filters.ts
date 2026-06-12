function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)

  if (pa <= pb && pa <= pc) {
    return a
  }

  if (pb <= pc) {
    return b
  }

  return c
}

export function unfilterRow(
  filterType: number,
  currentRow: Buffer,
  previousRow: Buffer | null,
  bytesPerPixel: number,
): Buffer | null {
  const result = Buffer.alloc(currentRow.length)

  for (let i = 0; i < currentRow.length; i++) {
    const raw = currentRow[i]
    const a = i >= bytesPerPixel ? result[i - bytesPerPixel] : 0
    const b = previousRow ? previousRow[i] : 0
    const c = i >= bytesPerPixel && previousRow ? previousRow[i - bytesPerPixel] : 0

    switch (filterType) {
      case 0:
        result[i] = raw
        break
      case 1:
        result[i] = (raw + a) & 0xff
        break
      case 2:
        result[i] = (raw + b) & 0xff
        break
      case 3:
        result[i] = (raw + Math.floor((a + b) / 2)) & 0xff
        break
      case 4:
        result[i] = (raw + paethPredictor(a, b, c)) & 0xff
        break
      default:
        return null
    }
  }

  return result
}
