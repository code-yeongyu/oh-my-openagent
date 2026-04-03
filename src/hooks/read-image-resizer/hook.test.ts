/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"

import type { ImageDimensions, ResizeResult } from "./types"
import * as imageDimensions from "./image-dimensions"
import * as imageResizer from "./image-resizer"
import * as sessionModelState from "../../shared/session-model-state"
import { createReadImageResizerHook } from "./hook"

const mockParseImageDimensions = mock((): ImageDimensions | null => null)
const mockCalculateTargetDimensions = mock((): ImageDimensions | null => null)
const mockResizeImage = mock(async (): Promise<ResizeResult | null> => null)
const mockGetSessionModel = mock((_sessionID: string) => ({
  providerID: "anthropic",
  modelID: "claude-sonnet-4-6",
} as { providerID: string; modelID: string } | undefined))

let parseImageDimensionsSpy: { mockRestore: () => void } | undefined
let calculateTargetDimensionsSpy: { mockRestore: () => void } | undefined
let resizeImageSpy: { mockRestore: () => void } | undefined
let getSessionModelSpy: { mockRestore: () => void } | undefined

function setupHookSpies(): void {
  parseImageDimensionsSpy = spyOn(imageDimensions, "parseImageDimensions").mockImplementation(mockParseImageDimensions)
  calculateTargetDimensionsSpy = spyOn(imageResizer, "calculateTargetDimensions").mockImplementation(mockCalculateTargetDimensions)
  resizeImageSpy = spyOn(imageResizer, "resizeImage").mockImplementation(mockResizeImage)
  getSessionModelSpy = spyOn(sessionModelState, "getSessionModel").mockImplementation(mockGetSessionModel)
}

type ToolOutput = {
  title: string
  output: string
  metadata: unknown
  attachments?: Array<{ mime: string; url: string; filename?: string }>
}

function createMockContext(): PluginInput {
  return {
    client: {} as PluginInput["client"],
    directory: "/test",
  } as PluginInput
}

function createInput(tool: string): { tool: string; sessionID: string; callID: string } {
  return {
    tool,
    sessionID: "session-1",
    callID: "call-1",
  }
}

describe("createReadImageResizerHook", () => {
  beforeEach(() => {
    setupHookSpies()
    mockParseImageDimensions.mockReset()
    mockCalculateTargetDimensions.mockReset()
    mockResizeImage.mockReset()
    mockGetSessionModel.mockReset()
    mockGetSessionModel.mockReturnValue({ providerID: "anthropic", modelID: "claude-sonnet-4-6" })
  })

  afterEach(() => {
    parseImageDimensionsSpy?.mockRestore()
    calculateTargetDimensionsSpy?.mockRestore()
    resizeImageSpy?.mockRestore()
    getSessionModelSpy?.mockRestore()
    parseImageDimensionsSpy = undefined
    calculateTargetDimensionsSpy = undefined
    resizeImageSpy = undefined
    getSessionModelSpy = undefined
  })

  it("skips non-Read tools", async () => {
    //#given
    const hook = createReadImageResizerHook(createMockContext())
    const output: ToolOutput = {
      title: "Read",
      output: "original output",
      metadata: {},
      attachments: [{ mime: "image/png", url: "data:image/png;base64,old", filename: "image.png" }],
    }

    //#when
    await hook["tool.execute.after"](createInput("Bash"), output)

    //#then
    expect(output.output).toBe("original output")
    expect(mockParseImageDimensions).not.toHaveBeenCalled()
  })

  it("skips when provider is not anthropic", async () => {
    //#given
    mockGetSessionModel.mockReturnValue({ providerID: "openai", modelID: "gpt-5.3-codex" })
    mockParseImageDimensions.mockReturnValue({ width: 3000, height: 2000 })
    mockCalculateTargetDimensions.mockReturnValue({ width: 1568, height: 1045 })
    const hook = createReadImageResizerHook(createMockContext())
    const output: ToolOutput = {
      title: "Read",
      output: "original output",
      metadata: {},
      attachments: [{ mime: "image/png", url: "data:image/png;base64,old", filename: "image.png" }],
    }

    //#when
    await hook["tool.execute.after"](createInput("Read"), output)

    //#then
    expect(output.output).toBe("original output")
    expect(mockParseImageDimensions).not.toHaveBeenCalled()
  })

  it("skips when session model is unknown", async () => {
    //#given
    mockGetSessionModel.mockReturnValue(undefined)
    mockParseImageDimensions.mockReturnValue({ width: 3000, height: 2000 })
    const hook = createReadImageResizerHook(createMockContext())
    const output: ToolOutput = {
      title: "Read",
      output: "original output",
      metadata: {},
      attachments: [{ mime: "image/png", url: "data:image/png;base64,old", filename: "image.png" }],
    }

    //#when
    await hook["tool.execute.after"](createInput("Read"), output)

    //#then
    expect(output.output).toBe("original output")
    expect(mockParseImageDimensions).not.toHaveBeenCalled()
  })

  it("skips Read output with no attachments", async () => {
    //#given
    const hook = createReadImageResizerHook(createMockContext())
    const output: ToolOutput = {
      title: "Read",
      output: "original output",
      metadata: {},
    }

    //#when
    await hook["tool.execute.after"](createInput("Read"), output)

    //#then
    expect(output.output).toBe("original output")
    expect(mockParseImageDimensions).not.toHaveBeenCalled()
  })

  it("skips non-image attachments", async () => {
    //#given
    const hook = createReadImageResizerHook(createMockContext())
    const output: ToolOutput = {
      title: "Read",
      output: "original output",
      metadata: {},
      attachments: [{ mime: "application/pdf", url: "data:application/pdf;base64,AAAA", filename: "file.pdf" }],
    }

    //#when
    await hook["tool.execute.after"](createInput("Read"), output)

    //#then
    expect(output.output).toBe("original output")
    expect(mockParseImageDimensions).not.toHaveBeenCalled()
  })

  it("skips unsupported image mime types", async () => {
    //#given
    const hook = createReadImageResizerHook(createMockContext())
    const output: ToolOutput = {
      title: "Read",
      output: "original output",
      metadata: {},
      attachments: [{ mime: "image/heic", url: "data:image/heic;base64,AAAA", filename: "photo.heic" }],
    }

    //#when
    await hook["tool.execute.after"](createInput("Read"), output)

    //#then
    expect(output.output).toBe("original output")
    expect(mockParseImageDimensions).not.toHaveBeenCalled()
  })

  it("appends within-limits metadata when image is already valid", async () => {
    //#given
    mockParseImageDimensions.mockReturnValue({ width: 800, height: 600 })
    mockCalculateTargetDimensions.mockReturnValue(null)

    const hook = createReadImageResizerHook(createMockContext())
    const output: ToolOutput = {
      title: "Read",
      output: "original output",
      metadata: {},
      attachments: [{ mime: "image/png", url: "data:image/png;base64,old", filename: "image.png" }],
    }

    //#when
    await hook["tool.execute.after"](createInput("Read"), output)

    //#then
    expect(output.output).toContain("[Image Info]")
    expect(output.output).toContain("within limits")
    expect(output.attachments?.[0]?.url).toBe("data:image/png;base64,old")
    expect(mockResizeImage).not.toHaveBeenCalled()
  })

  it("replaces attachment URL and appends resize metadata for oversized image", async () => {
    //#given
    mockParseImageDimensions.mockReturnValue({ width: 3000, height: 2000 })
    mockCalculateTargetDimensions.mockReturnValue({ width: 1568, height: 1045 })
    mockResizeImage.mockResolvedValue({
      resizedDataUrl: "data:image/png;base64,resized",
      original: { width: 3000, height: 2000 },
      resized: { width: 1568, height: 1045 },
    })

    const hook = createReadImageResizerHook(createMockContext())
    const output: ToolOutput = {
      title: "Read",
      output: "original output",
      metadata: {},
      attachments: [{ mime: "image/png", url: "data:image/png;base64,old", filename: "big.png" }],
    }

    //#when
    await hook["tool.execute.after"](createInput("Read"), output)

    //#then
    expect(output.attachments?.[0]?.url).toBe("data:image/png;base64,resized")
    expect(output.output).toContain("[Image Resize Info]")
    expect(output.output).toContain("resized")
  })

  it("keeps original attachment URL and marks resize skipped when resize fails", async () => {
    //#given
    mockParseImageDimensions.mockReturnValue({ width: 3000, height: 2000 })
    mockCalculateTargetDimensions.mockReturnValue({ width: 1568, height: 1045 })
    mockResizeImage.mockResolvedValue(null)

    const hook = createReadImageResizerHook(createMockContext())
    const output: ToolOutput = {
      title: "Read",
      output: "original output",
      metadata: {},
      attachments: [{ mime: "image/png", url: "data:image/png;base64,old", filename: "fail.png" }],
    }

    //#when
    await hook["tool.execute.after"](createInput("Read"), output)

    //#then
    expect(output.attachments?.[0]?.url).toBe("data:image/png;base64,old")
    expect(output.output).toContain("resize skipped")
  })

  it("appends unknown-dimensions metadata when parsing fails", async () => {
    //#given
    mockParseImageDimensions.mockReturnValue(null)

    const hook = createReadImageResizerHook(createMockContext())
    const output: ToolOutput = {
      title: "Read",
      output: "original output",
      metadata: {},
      attachments: [{ mime: "image/png", url: "data:image/png;base64,old", filename: "corrupt.png" }],
    }

    //#when
    await hook["tool.execute.after"](createInput("Read"), output)

    //#then
    expect(output.output).toContain("dimensions could not be parsed")
    expect(mockCalculateTargetDimensions).not.toHaveBeenCalled()
  })

  it("fires for lowercase read tool name", async () => {
    //#given
    mockParseImageDimensions.mockReturnValue({ width: 800, height: 600 })
    mockCalculateTargetDimensions.mockReturnValue(null)

    const hook = createReadImageResizerHook(createMockContext())
    const output: ToolOutput = {
      title: "Read",
      output: "original output",
      metadata: {},
      attachments: [{ mime: "image/png", url: "data:image/png;base64,old", filename: "image.png" }],
    }

    //#when
    await hook["tool.execute.after"](createInput("read"), output)

    //#then
    expect(mockParseImageDimensions).toHaveBeenCalledTimes(1)
    expect(output.output).toContain("within limits")
  })
})
