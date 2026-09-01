import { inflateSync } from "node:zlib"

import { unfilterRow } from "./png-filters"

export function decodePngPixels(
  idatData: Buffer,
  width: number,
  height: number,
  bytesPerPixel: number,
): Buffer | null {
  try {
    const decompressed = inflateSync(idatData)
    const rowBytes = width * bytesPerPixel
    const expectedLength = height * (rowBytes + 1)

    if (decompressed.length < expectedLength) {
      return null
    }

    const pixels = Buffer.alloc(width * height * bytesPerPixel)
    let previousRow: Buffer | null = null

    for (let y = 0; y < height; y++) {
      const rowStart = y * (rowBytes + 1)
      const filterType = decompressed[rowStart]
      const filteredRow = decompressed.subarray(rowStart + 1, rowStart + 1 + rowBytes)
      const unfilteredRow = unfilterRow(filterType, filteredRow, previousRow, bytesPerPixel)
      if (!unfilteredRow) {
        return null
      }

      unfilteredRow.copy(pixels, y * rowBytes)
      previousRow = unfilteredRow
    }

    return pixels
  } catch (error) {
    if (error instanceof Error) {
      return null
    }

    return null
  }
}
