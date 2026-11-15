import { refusal } from "./errors"
import type { Frame, FramePoint, Keyboard, Observation, Pointer, Target } from "./facade"
import { CaptureFrame, captureCaps, parseCapture } from "./frame"
import type { Link } from "./link"
import type {
  ActionReport,
  AxSnapshot,
  AxSnapshotOptions,
  CaptureOptions,
  ClickOptions,
  Delta,
  KeyboardOptions,
  KeyHoldOptions,
  MouseHoldOptions,
  ObserveOptions,
  PointerOptions,
  TargetId,
} from "./types"
import { parseAxSnapshot } from "./validate"

/** The engine `PointerOptions` of a facade call, without the fields the caller left out. */
function wireOptions(options: ClickOptions & KeyboardOptions = {}): object {
  const { button, count, modifiers, delivery, consume } = options
  return Object.fromEntries(
    Object.entries({ button, count, modifiers, deliveryMode: delivery, consume }).filter(
      ([, value]) => value !== undefined,
    ),
  )
}

function validateDuration(seconds: unknown): number {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0 || seconds > 100) {
    throw refusal("InvalidTarget", "hold durationSeconds must be finite seconds in 0..=100", "invalid_duration")
  }
  return seconds
}

/**
 * The frame a point aims with, checked before anything is sent: the frame must be a full capture of this same
 * target, never a zoom, and the point finite.
 */
function aim(
  target: TargetId,
  point: FramePoint,
): { readonly x: number; readonly y: number; readonly frameId: string } {
  const { frame, x, y } = point
  if (frame.target !== target) {
    throw refusal("InvalidCoordinateFrame", `a frame of ${frame.target} cannot aim input at ${target}`, "other_target")
  }
  if (frame.region !== null) {
    throw refusal("InvalidCoordinateFrame", "a zoom frame cannot aim input; use the full frame", "zoom_frame")
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw refusal("InvalidCoordinateFrame", "frame point coordinates must be finite", "invalid_point")
  }
  return { x, y, frameId: frame.id }
}

class InputPointer implements Pointer {
  readonly #link: Link
  readonly #target: TargetId

  constructor(link: Link, target: TargetId) {
    this.#link = link
    this.#target = target
  }

  async click(point: FramePoint, options?: ClickOptions): Promise<ActionReport> {
    const aimed = aim(this.#target, point)
    return this.#link.act("click", { target: this.#target, ...aimed, opts: wireOptions(options) }, options?.verify)
  }

  async move(point: FramePoint, options?: PointerOptions): Promise<ActionReport> {
    const aimed = aim(this.#target, point)
    return this.#link.act("moveMouse", { target: this.#target, ...aimed, opts: wireOptions(options) }, options?.verify)
  }

  async drag(from: FramePoint, to: FramePoint, options?: PointerOptions): Promise<ActionReport> {
    const start = aim(this.#target, from)
    const end = aim(this.#target, to)
    if (start.frameId !== end.frameId) {
      throw refusal("InvalidCoordinateFrame", "both drag points must come from the same frame", "mixed_frames")
    }
    const path = [
      { x: start.x, y: start.y },
      { x: end.x, y: end.y },
    ]
    const params = { target: this.#target, path, frameId: start.frameId, opts: wireOptions(options) }
    return this.#link.act("drag", params, options?.verify)
  }

  async scroll(point: FramePoint, delta: Delta, options?: PointerOptions): Promise<ActionReport> {
    const aimed = aim(this.#target, point)
    if (!Number.isFinite(delta.dx) || !Number.isFinite(delta.dy)) {
      throw refusal("InvalidTarget", "scroll delta must be finite", "invalid_delta")
    }
    const params = { target: this.#target, ...aimed, dx: delta.dx, dy: delta.dy, opts: wireOptions(options) }
    return this.#link.act("scroll", params, options?.verify)
  }

  async hold(point: FramePoint, options: MouseHoldOptions): Promise<ActionReport> {
    const duration = validateDuration(options?.durationSeconds)
    const aimed = aim(this.#target, point)
    const { button, ...rest } = options
    const params = {
      target: this.#target,
      ...aimed,
      duration,
      ...(button === undefined ? {} : { button }),
      opts: wireOptions(rest),
    }
    return this.#link.act("holdMouse", params, options.verify)
  }
}

class InputKeyboard implements Keyboard {
  readonly #link: Link
  readonly #target: TargetId

  constructor(link: Link, target: TargetId) {
    this.#link = link
    this.#target = target
  }

  async type(text: string, options?: KeyboardOptions): Promise<ActionReport> {
    return this.#link.act("typeText", { target: this.#target, text, opts: wireOptions(options) }, options?.verify)
  }

  async chord(keys: string, options?: KeyboardOptions): Promise<ActionReport> {
    const parts = keys
      .split("+")
      .map((key) => key.trim())
      .filter((key) => key.length > 0)
    if (parts.length === 0) throw refusal("InvalidKey", "chord needs at least one key", "empty_chord")
    const params = {
      target: this.#target,
      keys: parts,
      opts: wireOptions(options),
      ...(options?.force === undefined ? {} : { force: options.force }),
    }
    return this.#link.act("keyChord", params, options?.verify)
  }

  async hold(keys: readonly string[], options: KeyHoldOptions): Promise<ActionReport> {
    const duration = validateDuration(options?.durationSeconds)
    if (keys.length === 0) throw refusal("InvalidKey", "held keys must not be empty", "empty_chord")
    const params = { target: this.#target, keys: [...keys], duration, opts: wireOptions(options) }
    return this.#link.act("holdKeys", params, options.verify)
  }
}

export class CaptureTarget implements Target {
  readonly kind: "desktop" | "window"
  readonly target: TargetId
  readonly pointer: Pointer
  readonly keyboard: Keyboard
  protected readonly link: Link

  constructor(link: Link, kind: "desktop" | "window", target: TargetId) {
    this.link = link
    this.kind = kind
    this.target = target
    this.pointer = new InputPointer(link, target)
    this.keyboard = new InputKeyboard(link, target)
  }

  async screenshot(options?: CaptureOptions): Promise<Frame> {
    const caps = captureCaps(options)
    const params = { target: this.target, ...(caps === undefined ? {} : { caps }) }
    return new CaptureFrame(this.link, await this.link.read("capture", params, parseCapture))
  }

  async observe(options?: ObserveOptions): Promise<Observation> {
    const caps = captureCaps(options)
    const params = {
      target: this.target,
      ...(caps === undefined ? {} : { caps }),
      ...(options?.ax === undefined ? {} : { ax: options.ax }),
    }
    const { frame, ax } = await this.link.read("observe", params, (value) => {
      const capture = parseCapture(value)
      const snapshot = parseAxSnapshot(value, "ax")
      return capture === undefined || snapshot === undefined ? undefined : { frame: capture, ax: snapshot }
    })
    return { frame: new CaptureFrame(this.link, frame), ax }
  }

  ax(options?: AxSnapshotOptions): Promise<AxSnapshot> {
    const params = { target: this.target, ...(options === undefined ? {} : { opts: options }) }
    return this.link.read("ax.snapshot", params, (value) => parseAxSnapshot(value))
  }
}
