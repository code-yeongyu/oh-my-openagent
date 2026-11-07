// The SDK facade contract. scripts/generate-facade-manifest.ts reads the tagged members below into
// facade-manifest.json: `@tier` is the approval a call needs (read = inspection, exec = input or mutation),
// `@policy` what it may move (none, semantic, background, foreground; see `Policy`), `@wire` the engine
// methods it sends. Every method signature here must carry `@tier`, `@policy` and `@wire`.

import type { AuditEvent, DesktopCapabilities, EpochChanged, StopPathStatus } from "@oh-my-opencode/senpi-desktop-protocol";
import type {
	ActionOptions,
	ActionReport,
	AxNode,
	AxQuery,
	AxSnapshot,
	AxSnapshotOptions,
	CaptureOptions,
	ClickOptions,
	Delta,
	Display,
	Expectation,
	FrameId,
	KeyboardOptions,
	KeyHoldOptions,
	MenuItem,
	MouseHoldOptions,
	ObserveOptions,
	PointerOptions,
	Ref,
	Region,
	TargetId,
	TypeReport,
	Verdict,
	VerifyOptions,
	WindowFilter,
	WindowId,
	WindowIdentity,
	WindowSelector,
	Bounds,
} from "./types";

/** One desktop engine session seen through the SDK. */
export interface Computer {
	/**
	 * Runtime truth about what the backend can do right now.
	 * @tier read
	 * @policy none
	 * @wire capabilities
	 */
	capabilities(): Promise<DesktopCapabilities>;
	/**
	 * Every monitor in global points.
	 * @tier read
	 * @policy none
	 * @wire displays
	 */
	displays(): Promise<readonly Display[]>;
	/**
	 * Every top-level window matching `filter`.
	 * @tier read
	 * @policy none
	 * @wire windows
	 */
	windows(filter?: WindowFilter): Promise<readonly Window[]>;
	/**
	 * Exactly one window: none matching is `WindowNotFound`, more than one is `InvalidTarget` with reason `ambiguous`
	 * and the matches in `data.candidates`.
	 * @tier read
	 * @policy none
	 * @wire windows
	 */
	window(selector: WindowSelector): Promise<Window>;
	/** The whole desktop as one capture and input target. */
	readonly desktop: Target;
	readonly control: Control;
	readonly stop: StopPath;
	/** One event per mutating request, success or failure. */
	readonly audit: Events<AuditEvent>;
	/** Display change, lock, sleep, Space switch or engine restart: earlier frames and refs no longer hold. */
	readonly epoch: Events<EpochChanged>;
	/**
	 * Polls READ calls until `expectation` holds or the deadline passes; never sends input and never sleeps past
	 * the deadline. `unknown` when a read fails.
	 * @tier read
	 * @policy none
	 * @wire ax.node, ax.attributes, windows
	 */
	verify(expectation: Expectation, options?: VerifyOptions): Promise<Verdict>;
	/**
	 * Runs `steps` in order, each like one tool call, and stops at the first failure.
	 * @tier exec
	 * @policy none
	 * @wire
	 */
	batch(steps: readonly Step[], options?: BatchOptions): Promise<BatchReport>;
	/**
	 * Detaches this SDK connection; later calls fail `Closed`. The host's own session stays open.
	 * @tier read
	 * @policy none
	 * @wire
	 */
	close(): Promise<void>;
}

/** Something to capture and send input to: the desktop or one window. */
export interface Target {
	readonly kind: "desktop" | "window";
	readonly target: TargetId;
	/**
	 * A full capture; its frame is what coordinate input aims with.
	 * @tier read
	 * @policy none
	 * @wire capture
	 */
	screenshot(options?: CaptureOptions): Promise<Frame>;
	/**
	 * A capture and the AX tree of the same moment, in one engine request.
	 * @tier read
	 * @policy none
	 * @wire observe
	 */
	observe(options?: ObserveOptions): Promise<Observation>;
	/**
	 * The accessibility tree; `options.since` returns only nodes changed after that generation.
	 * @tier read
	 * @policy none
	 * @wire ax.snapshot
	 */
	ax(options?: AxSnapshotOptions): Promise<AxSnapshot>;
	readonly pointer: Pointer;
	readonly keyboard: Keyboard;
}

/** A capture of one target. Input coordinates are pixels of a full (non-zoom) frame of the same target. */
export interface Frame {
	readonly id: FrameId;
	readonly target: TargetId;
	/** The window's identity when it was captured; `null` for the desktop or an engine without object mode. */
	readonly identity: WindowIdentity | null;
	readonly width: number;
	readonly height: number;
	readonly coordinateWidth: number;
	readonly coordinateHeight: number;
	/** Set on a zoom: the rectangle of the full frame it shows. A zoom frame never aims input. */
	readonly region: Region | null;
	readonly image: Uint8Array | null;
	readonly mimeType: string;
	readonly artifactPath: string | null;
	/**
	 * Native detail of `region` of this frame; the zoom does not replace this frame for input.
	 * @tier read
	 * @policy none
	 * @wire captureRegion
	 */
	zoom(region: Region): Promise<Frame>;
}

/** A point in a frame's pixels. */
export interface FramePoint {
	readonly frame: Frame;
	readonly x: number;
	readonly y: number;
}

export interface Observation {
	readonly frame: Frame;
	readonly ax: AxSnapshot;
}

/** Pointer input at frame points. */
export interface Pointer {
	/**
	 * @tier exec
	 * @policy background
	 * @wire click
	 */
	click(point: FramePoint, options?: ClickOptions): Promise<ActionReport>;
	/**
	 * @tier exec
	 * @policy background
	 * @wire moveMouse
	 */
	move(point: FramePoint, options?: PointerOptions): Promise<ActionReport>;
	/**
	 * Both points come from the same frame.
	 * @tier exec
	 * @policy background
	 * @wire drag
	 */
	drag(from: FramePoint, to: FramePoint, options?: PointerOptions): Promise<ActionReport>;
	/**
	 * @tier exec
	 * @policy background
	 * @wire scroll
	 */
	scroll(point: FramePoint, delta: Delta, options?: PointerOptions): Promise<ActionReport>;
	/**
	 * Holds a button for 0..=100 s; it is released before the call returns, also on interruption.
	 * @tier exec
	 * @policy background
	 * @wire holdMouse
	 */
	hold(point: FramePoint, options: MouseHoldOptions): Promise<ActionReport>;
}

/** Keyboard input to a target. */
export interface Keyboard {
	/**
	 * @tier exec
	 * @policy background
	 * @wire typeText
	 */
	type(text: string, options?: KeyboardOptions): Promise<ActionReport>;
	/**
	 * `keys` joined by `+` (`cmd+s`); dangerous chords need `force`.
	 * @tier exec
	 * @policy background
	 * @wire keyChord
	 */
	chord(keys: string, options?: KeyboardOptions): Promise<ActionReport>;
	/**
	 * Presses in order and releases in reverse before the call returns.
	 * @tier exec
	 * @policy background
	 * @wire holdKeys
	 */
	hold(keys: readonly string[], options: KeyHoldOptions): Promise<ActionReport>;
}

/** One top-level window; every call goes by `id`, the other fields are as listed. */
export interface Window extends Target {
	readonly kind: "window";
	readonly id: WindowId;
	readonly identity: WindowIdentity | null;
	readonly app: string;
	readonly title: string;
	readonly pid: number | null;
	readonly bounds: Bounds;
	readonly focused: boolean;
	readonly menu: Menus;
	/**
	 * Brings the window to the front.
	 * @tier exec
	 * @policy foreground
	 * @wire raiseWindow
	 */
	raise(options?: ActionOptions): Promise<ActionReport>;
	/**
	 * An element of this window by ref, without a read; `node` stays `null` until `read()`.
	 * @tier read
	 * @policy none
	 * @wire
	 */
	element(ref: Ref): Element;
	/**
	 * @tier read
	 * @policy none
	 * @wire ax.query
	 */
	find(query: AxQuery): Promise<readonly Element[]>;
}

/** The native menu of one window; an empty path is the menu bar. */
export interface Menus {
	/**
	 * @tier read
	 * @policy none
	 * @wire menus.items
	 */
	items(path?: readonly string[]): Promise<readonly MenuItem[]>;
	/**
	 * @tier exec
	 * @policy semantic
	 * @wire menus.select
	 */
	select(path: readonly string[], options?: ActionOptions): Promise<ActionReport>;
}

/** One accessibility element; every call re-resolves `ref` in the engine. */
export interface Element {
	readonly ref: Ref;
	/** The node as last read; `null` for an element made from a bare ref. */
	readonly node: AxNode | null;
	/**
	 * @tier read
	 * @policy none
	 * @wire ax.node
	 */
	read(): Promise<AxNode>;
	/**
	 * @tier exec
	 * @policy semantic
	 * @wire ax.perform
	 */
	press(options?: ActionOptions): Promise<ActionReport>;
	/**
	 * @tier exec
	 * @policy semantic
	 * @wire ax.click
	 */
	click(options?: ActionOptions): Promise<ActionReport>;
	/**
	 * @tier exec
	 * @policy semantic
	 * @wire ax.setValue
	 */
	setValue(value: string, options?: ActionOptions): Promise<ActionReport>;
	/**
	 * Inserted through the element's own selection, or keys once it holds its app's keyboard focus.
	 * @tier exec
	 * @policy semantic
	 * @wire ax.typeText
	 */
	type(text: string, options?: ActionOptions): Promise<TypeReport>;
	/**
	 * @tier exec
	 * @policy semantic
	 * @wire ax.focus
	 */
	focus(options?: ActionOptions): Promise<ActionReport>;
	/**
	 * @tier exec
	 * @policy semantic
	 * @wire ax.perform
	 */
	perform(action: string, options?: ActionOptions): Promise<ActionReport>;
	/**
	 * @tier read
	 * @policy none
	 * @wire ax.attributes
	 */
	attributes(): Promise<Readonly<Record<string, string>>>;
	/**
	 * The tree under this element only; refs of the parent snapshot stay valid.
	 * @tier read
	 * @policy none
	 * @wire ax.snapshot
	 */
	drill(options?: AxSnapshotOptions): Promise<AxSnapshot>;
}

export interface ControlState {
	readonly active: boolean;
	readonly reason: string | null;
	readonly grantedAt: string | null;
}

/** The foreground-control grant held for this session. */
export interface ControlLease extends ControlState {
	/**
	 * @tier exec
	 * @policy none
	 * @wire control.revoke
	 */
	release(): Promise<void>;
}

/** Foreground control: one grant per engine process, asked of the human first. */
export interface Control {
	/**
	 * Asks the human through the host's confirm channel, then grants; `ControlRequired` when nobody can be asked
	 * or the human declines.
	 * @tier exec
	 * @policy none
	 * @wire control.state, control.grant
	 */
	acquire(reason: string): Promise<ControlLease>;
	/**
	 * @tier read
	 * @policy none
	 * @wire control.state
	 */
	state(): Promise<ControlState>;
	/**
	 * @tier exec
	 * @policy none
	 * @wire control.revoke
	 */
	release(): Promise<void>;
}

/** The user's stop path. */
export interface StopPath {
	/**
	 * @tier read
	 * @policy none
	 * @wire stopPath.status
	 */
	status(): Promise<StopPathStatus>;
	/**
	 * Called on every `stopPath.changed`; returns the unsubscribe function.
	 * @tier read
	 * @policy none
	 * @wire stopPath.changed
	 */
	on(listener: (status: StopPathStatus) => void): () => void;
}

/** A notification stream. */
export interface Events<T> {
	/**
	 * Returns the unsubscribe function.
	 * @tier read
	 * @policy none
	 * @wire audit, epoch.changed
	 */
	on(listener: (event: T) => void): () => void;
}

/** One batch step: an action against the computer, equivalent to one tool call. */
export interface Step {
	readonly label?: string;
	readonly run: (computer: Computer) => Promise<ActionReport>;
}

export interface BatchOptions {
	readonly signal?: AbortSignal;
}

export type BatchStepOutcome =
	| { readonly label: string | null; readonly status: "ok"; readonly report: ActionReport }
	| { readonly label: string | null; readonly status: "failed"; readonly report: ActionReport; readonly error: unknown }
	| { readonly label: string | null; readonly status: "skipped" };

/** `stoppedAt` is the index of the failed step, `null` when every step ran. */
export interface BatchReport {
	readonly completed: number;
	readonly of: number;
	readonly stoppedAt: number | null;
	readonly steps: readonly BatchStepOutcome[];
}
