export function nearestNeighborResize(
  sourcePixels: Buffer,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
  bytesPerPixel: number,
): Buffer {
  const destPixels = Buffer.alloc(dstWidth * dstHeight * bytesPerPixel)

  for (let dstY = 0; dstY < dstHeight; dstY++) {
    const srcY = Math.min(Math.floor((dstY * srcHeight) / dstHeight), srcHeight - 1)

    for (let dstX = 0; dstX < dstWidth; dstX++) {
      const srcX = Math.min(Math.floor((dstX * srcWidth) / dstWidth), srcWidth - 1)
      const srcOffset = (srcY * srcWidth + srcX) * bytesPerPixel
      const dstOffset = (dstY * dstWidth + dstX) * bytesPerPixel

      for (let b = 0; b < bytesPerPixel; b++) {
        destPixels[dstOffset + b] = sourcePixels[srcOffset + b]
      }
    }
  }

  return destPixels
}
