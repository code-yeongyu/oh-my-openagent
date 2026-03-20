/// <reference types="bun-types" />

import { afterEach, describe, expect, it, mock } from "bun:test"

const PNG_1X1_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

type ImageResizerModule = typeof import("./image-resizer")

async function importFreshImageResizerModule(): Promise<ImageResizerModule> {
  return import(`./image-resizer?test-${Date.now()}-${Math.random()}`)
}

describe("calculateTargetDimensions", () => {
  it("returns null when dimensions are already within limits", async () => {
    //#given
    const { calculateTargetDimensions } = await importFreshImageResizerModule()

    //#when
    const result = calculateTargetDimensions(800, 600)

    //#then
    expect(result).toBeNull()
  })

  it("returns null at exact long-edge boundary", async () => {
    //#given
    const { calculateTargetDimensions } = await importFreshImageResizerModule()

    //#when
    const result = calculateTargetDimensions(1568, 1000)

    //#then
    expect(result).toBeNull()
  })

  it("scales landscape dimensions by max long edge", async () => {
    //#given
    const { calculateTargetDimensions } = await importFreshImageResizerModule()

    //#when
    const result = calculateTargetDimensions(3000, 2000)

    //#then
    expect(result).toEqual({
      width: 1568,
      height: Math.floor(2000 * (1568 / 3000)),
    })
  })

  it("scales portrait dimensions by max long edge", async () => {
    //#given
    const { calculateTargetDimensions } = await importFreshImageResizerModule()

    //#when
    const result = calculateTargetDimensions(2000, 3000)

    //#then
    expect(result).toEqual({
      width: Math.floor(2000 * (1568 / 3000)),
      height: 1568,
    })
  })

  it("scales square dimensions to exact target", async () => {
    //#given
    const { calculateTargetDimensions } = await importFreshImageResizerModule()

    //#when
    const result = calculateTargetDimensions(4000, 4000)

    //#then
    expect(result).toEqual({ width: 1568, height: 1568 })
  })

  it("uses custom maxLongEdge when provided", async () => {
    //#given
    const { calculateTargetDimensions } = await importFreshImageResizerModule()

    //#when
    const result = calculateTargetDimensions(2000, 1000, 1000)

    //#then
    expect(result).toEqual({ width: 1000, height: 500 })
  })
})

describe("resizeImage", () => {
  afterEach(() => {
    mock.restore()
  })

  it("returns null when sharp import fails", async () => {
    //#given
    mock.module("sharp", () => {
      throw new Error("sharp unavailable")
    })
    const { resizeImage } = await importFreshImageResizerModule()

    //#when
    const result = await resizeImage(PNG_1X1_DATA_URL, "image/png", {
      width: 1,
      height: 1,
    })

    //#then
    expect(result).toBeNull()
  })

  it("returns null when sharp throws during resize", async () => {
    //#given
    const mockSharpFactory = mock(() => ({
      resize: () => {
        throw new Error("resize failed")
      },
    }))

    mock.module("sharp", () => ({
      default: mockSharpFactory,
    }))
    const { resizeImage } = await importFreshImageResizerModule()

    //#when
    const result = await resizeImage(PNG_1X1_DATA_URL, "image/png", {
      width: 1,
      height: 1,
    })

    //#then
    expect(result).toBeNull()
  })
})
