import type { Frame } from "./facade"
import type { Link } from "./link"
import type { CaptureOptions, Region, WindowIdentity } from "./types"
import { isRecord, parseIdentity } from "./validate"

/** The `capture`/`captureRegion`/`observe` reply fields a frame is made of. */
export interface CaptureFields {
  readonly frameId: string
  readonly target: string
  readonly identity: WindowIdentity | null
  readonly width: number
  readonly height: number
  readonly coordinateWidth: number
  readonly coordinateHeight: number
  readonly region: Region | null
  readonly data: string | null
  readonly mimeType: string
  readonly artifactPath: string | null
}

const MODES: ReadonlySet<unknown> = new Set(["inline-png", "inline-jpeg", "artifact-only"])
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)
const isNullableString = (value: unknown): value is string | null | undefined =>
  value === null || value === undefined || typeof value === "string"

function parseRegion(value: unknown): Region | null | undefined {
  if (value === null || value === undefined) return null
  if (!isRecord(value)) return undefined
  const { x, y, width, height } = value
  return isNumber(x) && isNumber(y) && isNumber(width) && isNumber(height) ? { x, y, width, height } : undefined
}

/** A capture reply; `coordinateWidth`/`Height` default to the image size for engines that predate zoom. */
export function parseCapture(value: unknown): CaptureFields | undefined {
  if (!isRecord(value) || typeof value.frameId !== "string" || typeof value.target !== "string") return undefined
  if (!MODES.has(value.mode) || !isNumber(value.width) || !isNumber(value.height)) return undefined
  const { data, mimeType, artifactPath } = value
  if (!isNullableString(data) || !isNullableString(mimeType) || !isNullableString(artifactPath)) return undefined
  const coordinateWidth = value.coordinateWidth ?? value.width
  const coordinateHeight = value.coordinateHeight ?? value.height
  const region = parseRegion(value.region)
  const identity = parseIdentity(value.identity)
  if (!isNumber(coordinateWidth) || !isNumber(coordinateHeight) || region === undefined || identity === undefined) {
    return undefined
  }
  if (value.mode !== "artifact-only" && typeof data !== "string") return undefined
  return {
    frameId: value.frameId,
    target: value.target,
    identity,
    width: value.width,
    height: value.height,
    coordinateWidth,
    coordinateHeight,
    region,
    data: data ?? null,
    mimeType: mimeType ?? (value.mode === "inline-jpeg" ? "image/jpeg" : "image/png"),
    artifactPath: artifactPath ?? null,
  }
}

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/** Engine `CaptureCaps` from facade options; `undefined` keeps the session's caps. */
export function captureCaps(options: CaptureOptions | undefined): object | undefined {
  if (options === undefined) return undefined
  const { maxDimension, maxBytes, coordinateSafe } = options
  const caps = {
    ...(maxDimension === undefined ? {} : { maxWidth: maxDimension, maxHeight: maxDimension }),
    ...(maxBytes === undefined ? {} : { maxBytes }),
    ...(coordinateSafe === undefined ? {} : { coordinateSafe }),
  }
  return Object.keys(caps).length === 0 ? undefined : caps
}

export class CaptureFrame implements Frame {
  readonly id: string
  readonly target: string
  readonly identity: WindowIdentity | null
  readonly width: number
  readonly height: number
  readonly coordinateWidth: number
  readonly coordinateHeight: number
  readonly region: Region | null
  readonly image: Uint8Array | null
  readonly mimeType: string
  readonly artifactPath: string | null
  readonly #link: Link

  constructor(link: Link, fields: CaptureFields) {
    this.#link = link
    this.id = fields.frameId
    this.target = fields.target
    this.identity = fields.identity
    this.width = fields.width
    this.height = fields.height
    this.coordinateWidth = fields.coordinateWidth
    this.coordinateHeight = fields.coordinateHeight
    this.region = fields.region
    this.image = fields.data === null ? null : decodeBase64(fields.data)
    this.mimeType = fields.mimeType
    this.artifactPath = fields.artifactPath
  }

  async zoom(region: Region): Promise<Frame> {
    const params = { target: this.target, region, frameId: this.id }
    return new CaptureFrame(this.#link, await this.#link.read("captureRegion", params, parseCapture))
  }
}
