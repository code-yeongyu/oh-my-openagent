import type { AuditRecord, EngineMethod } from "@oh-my-opencode/senpi-desktop-protocol"
import type { ComputerHandle } from "./activation"
import type { ComputerToolResult } from "./tool"

type Picture =
  | { readonly kind: "available" }
  | {
      readonly kind: "withheld"
      readonly reason: "secure_input" | "locked" | "permission_missing" | "unknown"
    }

export interface ComputerSessionPoint {
  readonly space: "frame"
  readonly action: "click" | "navigate" | "drag" | "scroll"
  readonly frameId?: string
  readonly target: string
  readonly x: number
  readonly y: number
}

export interface ComputerSessionMetadata {
  /** Null when no activation succeeded; never substitute an agent or call ID. */
  readonly id: string | null
  readonly lifecycle: "open" | "ended" | "unavailable"
  readonly stopped?: boolean
  readonly picture: Picture
  readonly point?: ComputerSessionPoint
  readonly capture?: ComputerSessionCapture
}

export interface ComputerSessionCapture {
  readonly frameId: string
  readonly target: string
  readonly width: number
  readonly height: number
}

function captureGeometry(reply: unknown): ComputerSessionCapture | undefined {
  if (
    !record(reply) ||
    typeof reply.frameId !== "string" ||
    typeof reply.target !== "string" ||
    typeof reply.width !== "number" ||
    typeof reply.height !== "number" ||
    !Number.isSafeInteger(reply.width) ||
    !Number.isSafeInteger(reply.height) ||
    reply.width <= 0 ||
    reply.height <= 0 ||
    reply.region != null
  )
    return
  return { frameId: reply.frameId, target: reply.target, width: reply.width, height: reply.height }
}

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** These are the SDK's normalized wire arguments, not a model's code or the text of an action report. */
function framePoint(method: EngineMethod, params: unknown): ComputerSessionPoint | undefined {
  if (!record(params) || typeof params.target !== "string") return
  const point: unknown = method === "drag" && Array.isArray(params.path) ? params.path.at(-1) : params
  if (
    !record(point) ||
    typeof point.x !== "number" ||
    typeof point.y !== "number" ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y)
  )
    return
  const action =
    method === "click" || method === "holdMouse"
      ? "click"
      : method === "moveMouse"
        ? "navigate"
        : method === "drag" || method === "scroll"
          ? method
          : undefined
  if (action === undefined) return
  return {
    space: "frame",
    action,
    ...(typeof params.frameId === "string" ? { frameId: params.frameId } : {}),
    target: params.target,
    x: point.x,
    y: point.y,
  }
}

/** Where a run's last input pointed and what it last captured: viewer metadata, never model-visible. */
export interface ComputerFrame {
  readonly point?: ComputerSessionPoint
  readonly capture?: ComputerSessionCapture
}

/** A run's result with its frame beside `details`, so the public details type never carries it. */
export interface ComputerRunResult extends ComputerToolResult {
  readonly frame?: ComputerFrame
}

const CAPTURE_METHODS: ReadonlySet<EngineMethod> = new Set<EngineMethod>(["capture", "observe", "captureRegion"])

/** Accumulates the frame a run touches while its engine traffic passes; mutable by purpose. */
export class FrameRecorder {
  #point: ComputerSessionPoint | undefined
  #capture: ComputerSessionCapture | undefined

  /** Every input action replaces the point, so a later input without coordinates clears it. */
  input(method: EngineMethod, params: unknown): void {
    this.#point = framePoint(method, params)
  }

  reply(method: EngineMethod, reply: unknown): void {
    if (CAPTURE_METHODS.has(method)) this.#capture = captureGeometry(reply)
  }

  frame(audit: readonly AuditRecord[]): ComputerFrame | undefined {
    // The legacy facade omits frameId to use the target's latest frame. Only the engine's
    // audit of that input can say which frame it actually resolved.
    const last = audit.at(-1)
    let point = this.#point
    if (point !== undefined && point.frameId === undefined && last?.target === point.target && last.frameId != null)
      point = { ...point, frameId: last.frameId }
    const capture = this.#capture
    if (point === undefined && capture === undefined) return
    return { ...(point === undefined ? {} : { point }), ...(capture === undefined ? {} : { capture }) }
  }
}

const unknown: Picture = { kind: "withheld", reason: "unknown" }

function reportedPicture(status: unknown): Picture {
  if (!record(status)) return unknown
  switch (status.pictureState) {
    case "available":
      return { kind: "available" }
    case "secure_input":
    case "locked":
    case "permission_missing":
      return { kind: "withheld", reason: status.pictureState }
    default:
      return unknown
  }
}

export interface SessionResultOptions {
  /** The tool call's signal: an aborted call reads no viewer status. */
  readonly signal?: AbortSignal | undefined
  /** The identity `close` just ended. */
  readonly endedId?: string
}

/** A missing or failed viewer-status read must never turn a completed computer action into a failed action. */
export async function withSessionResult(
  handle: ComputerHandle,
  result: ComputerRunResult,
  { signal, endedId }: SessionResultOptions = {},
): Promise<ComputerToolResult> {
  const id = endedId ?? handle.computerSessionId ?? null
  const lifecycle = endedId !== undefined ? "ended" : id === null ? "unavailable" : "open"
  let picture: Picture = unknown
  let stopped: boolean | undefined
  if (lifecycle === "open") {
    try {
      const status = await handle.service.viewerStatus(signal)
      if (id === handle.computerSessionId) {
        picture = reportedPicture(status)
        if (record(status) && typeof status.suspended === "boolean") stopped = status.suspended
      }
    } catch (error) {
      handle.service.reportError(error)
    }
  }
  const { frame, ...toolResult } = result
  return {
    ...toolResult,
    details: {
      ...result.details,
      computerSession: {
        id,
        lifecycle,
        picture,
        ...(stopped === undefined ? {} : { stopped }),
        ...frame,
      },
    },
  }
}
