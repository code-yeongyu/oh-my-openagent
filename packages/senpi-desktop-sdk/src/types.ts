// Data shapes of the SDK facade. Wire-backed shapes mirror crates/senpi-desktop-core/schema/engine.schema.json
// (`DesktopWindow`, `WindowIdentity`, `DesktopDisplay`, `AxNode`, `AxSnapshot`, `ActionReport`, `Disposition`);
// validate.ts checks every engine reply against them before the facade hands it out.

/** Opaque engine window id, valid while the window lives. */
export type WindowId = string;
/** Opaque engine element ref (`e12`). */
export type Ref = string;
/** Engine capture frame id; coordinate input names the frame its point came from. */
export type FrameId = string;
/** Engine capture target: `desktop`, `display:<id>`, or a window id. */
export type TargetId = string;
/** Accessibility role, an open token set (`button`, `textField`, ...). */
export type Role = string;
/** The generation an AX snapshot registered its refs under. */
export type RefGeneration = number;

/** Who owns a window, so a reused window number is told apart. */
export interface WindowIdentity {
	readonly windowNumber: string;
	readonly pid: number;
	readonly processStart: number | null;
}

export interface Bounds {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/** Rectangle in a frame's pixels. */
export type Region = Bounds;

/** One monitor in global points plus its pixel rectangle. */
export interface Display {
	readonly id: string;
	readonly name: string;
	readonly bounds: Bounds;
	readonly scale: number;
	readonly pixelBounds: Bounds;
	readonly isPrimary: boolean;
}

/** Selects windows; every given field must match. `app` and `title` are case-insensitive substrings. */
export interface WindowFilter {
	readonly id?: WindowId;
	readonly app?: string;
	readonly title?: string;
}

/** One window as listed by the engine, before it is resolved to a `Window` target. */
export interface WindowSummary {
	readonly id: WindowId;
	readonly app: string;
	readonly title: string;
	readonly pid: number | null;
	readonly bounds: Bounds;
	readonly focused: boolean;
	readonly identity: WindowIdentity | null;
}

export type EvidenceState = "known" | "absent" | "unknown";

/** How each AX field was obtained; absent from engines without object mode. */
export interface AxEvidence {
	readonly title: EvidenceState;
	readonly value: EvidenceState;
	readonly description: EvidenceState;
	readonly enabled: EvidenceState;
	readonly focused: EvidenceState;
	readonly bounds: EvidenceState;
}

/** One accessibility element; bounds are global logical points. */
export interface AxNode {
	readonly ref: Ref;
	readonly role: Role;
	readonly nativeRole: string;
	readonly title: string | null;
	readonly value: string | null;
	readonly description: string | null;
	readonly enabled: boolean;
	readonly focused: boolean;
	readonly bounds: Bounds | null;
	readonly actions: readonly string[];
	readonly childCount: number;
	readonly evidence: AxEvidence | null;
	readonly subtreeTruncated: boolean;
	readonly secure: boolean;
}

/** A node whose children were left out of the snapshot. */
export interface AxCut {
	readonly ref: Ref;
	readonly childCount: number;
}

/** The formatted accessibility tree of one target, one node per line with `[ref=eN]` tags. */
export interface AxSnapshot {
	readonly text: string;
	readonly nodeCount: number;
	readonly truncated: boolean;
	/** `null` from engines without object mode. */
	readonly generation: RefGeneration | null;
	/** The generation a drill-down snapshot hangs under. */
	readonly parent: RefGeneration | null;
	readonly complete: boolean | null;
	readonly nodesObserved: number | null;
	readonly cuts: readonly AxCut[];
}

/** Narrows an AX snapshot; `since` returns only nodes changed after that generation. */
export interface AxSnapshotOptions {
	readonly maxDepth?: number;
	readonly maxNodes?: number;
	readonly all?: boolean;
	readonly timeoutMs?: number;
	readonly since?: RefGeneration;
	readonly skeleton?: boolean;
}

export interface AxQuery {
	readonly role?: Role;
	readonly title?: string;
	readonly value?: string;
	readonly limit?: number;
}

/** Engine capture caps; omitted fields take the session's defaults. */
export interface CaptureOptions {
	/** Long-edge cap in pixels; input coordinates stay in `coordinateWidth` x `coordinateHeight`. */
	readonly maxDimension?: number;
	readonly maxBytes?: number;
	readonly coordinateSafe?: boolean;
}

export type ObserveOptions = CaptureOptions & { readonly ax?: AxSnapshotOptions };

/** Whether input reached the target, and whether sending the same request again could duplicate it. */
export type Disposition =
	| { readonly delivery: "not_delivered"; readonly retry: "safe" | "after_user" }
	| { readonly delivery: "delivery_uncertain"; readonly retry: "unsafe" | "unknown" }
	| { readonly delivery: "delivered_unverified"; readonly retry: "unsafe" }
	| { readonly delivery: "delivered_verified"; readonly retry: "unsafe" }
	| { readonly delivery: "unknown"; readonly retry: "unknown" };

/** What a read-back of the target showed; `refused` appears only in SDK batch reports. */
export type ActionEffect = "confirmed" | "unverifiable" | "no_change" | "refused";
export type ActionRoute = "ax" | "background_window" | "background_pid" | "foreground_hid";
export type FocusRestoration = "not_needed" | "restored" | "user_moved_on" | "not_confirmed";

/** A sheet, dialog, menu, popover or window the action opened. */
export interface OpenedSurface {
	readonly kind: string;
	readonly title: string | null;
	readonly windowId: WindowId | null;
	readonly ref: Ref | null;
}

/** Per-stage durations in ms, present only while `computer.trace` is on. */
export type StageTimings = Readonly<Record<string, number>>;

/** The outcome of one input action. */
export interface ActionReport {
	readonly disposition: Disposition;
	/** Characters, keys or steps delivered out of those requested; `null` when the engine does not count. */
	readonly delivered: { readonly count: number; readonly of: number } | null;
	readonly effect: ActionEffect;
	readonly route: ActionRoute | null;
	/** The element under the point before sending; `label` is `null` for a secure field. */
	readonly hit: { readonly role: Role; readonly label: string | null } | null;
	readonly focusRestoration: FocusRestoration;
	readonly openedSurfaces: readonly OpenedSurface[];
	readonly nextCall: { readonly method: string; readonly args: Readonly<Record<string, unknown>> } | null;
	readonly note: string | null;
	readonly warning: string | null;
	/** Ids of the audit events this action emitted; the bodies arrive on `computer.audit`. */
	readonly auditIds: readonly string[];
	readonly timings: StageTimings | null;
	/** `true` when the engine replied `null` (no `action-report` feature or a `reportMode: "null"` session). */
	readonly legacy: boolean;
}

/** How an element typed its text: through its own selection, or as keystrokes once focused. */
export type TypeReport = ActionReport & { readonly input: "inserted" | "keys" };

/** What a facade action may move: focus, the cursor, physical input. */
export interface Policy {
	readonly focus: "never" | "exact_window" | "activate";
	readonly cursor: "never" | "move";
	readonly physical: "never" | "allowed";
}

/** AX element actions: nothing moves and no synthetic input is sent. */
export const SEMANTIC: Policy = Object.freeze({ focus: "never", cursor: "never", physical: "never" });
/** Background input aimed at one window without focusing it. */
export const BACKGROUND: Policy = Object.freeze({ focus: "never", cursor: "never", physical: "allowed" });
/** Foreground input: activates the target and moves the cursor; needs the control lease. */
export const FOREGROUND: Policy = Object.freeze({ focus: "activate", cursor: "move", physical: "allowed" });

/** `background` targets the window without focusing it; `foreground` activates it and needs the control lease. */
export type Delivery = "background" | "foreground";

/** Reads the target back after the action and fills the report's `effect` from the verdict. */
export interface VerifyAfter {
	readonly expectation: Expectation;
	readonly timeoutMs?: number;
}

export interface ActionOptions {
	readonly delivery?: Delivery;
	readonly verify?: VerifyAfter;
}

export type Button = "left" | "right" | "middle";

export interface PointerOptions extends ActionOptions {
	/** After this action the frame may not be used for input again. */
	readonly consume?: boolean;
	readonly modifiers?: readonly string[];
}

export interface ClickOptions extends PointerOptions {
	readonly button?: Button;
	readonly count?: 1 | 2 | 3;
}

export interface MouseHoldOptions extends PointerOptions {
	/** Finite seconds in 0..=100; the button is released before the call returns. */
	readonly durationSeconds: number;
	readonly button?: Button;
}

export interface KeyboardOptions extends ActionOptions {
	/** Sends a chord the engine treats as dangerous (`cmd+q`, `alt+f4`). */
	readonly force?: boolean;
}

export interface KeyHoldOptions extends KeyboardOptions {
	/** Finite seconds in 0..=100; the keys are released before the call returns. */
	readonly durationSeconds: number;
}

export interface Delta {
	readonly dx: number;
	readonly dy: number;
}

export interface MenuItem {
	readonly title: string;
	readonly path: readonly string[];
	readonly enabled: boolean;
	readonly checked: boolean;
	readonly hasSubmenu: boolean;
	readonly shortcut: string | null;
}

/** Picks a window by opaque id or by filter. */
export type WindowSelector = WindowId | WindowFilter;

/** A state `verify` polls for with READ calls only. */
export type Expectation =
	| { readonly kind: "elementExists"; readonly ref: Ref; readonly exists?: boolean }
	| { readonly kind: "elementValue"; readonly ref: Ref; readonly value: string }
	| { readonly kind: "elementEnabled"; readonly ref: Ref; readonly enabled?: boolean }
	| { readonly kind: "elementSelected"; readonly ref: Ref; readonly selected?: boolean }
	| { readonly kind: "windowExists"; readonly window: WindowSelector }
	| { readonly kind: "windowGone"; readonly window: WindowSelector }
	| { readonly kind: "windowBounds"; readonly window: WindowSelector; readonly bounds: Partial<Bounds>; readonly tolerance?: number };

export interface VerifyOptions {
	/** Deadline for the whole poll, in ms (default 2000). */
	readonly timeoutMs?: number;
	/** Time between reads, in ms (default 100, floor 10, never past the deadline). */
	readonly intervalMs?: number;
	readonly signal?: AbortSignal;
}

/**
 * `satisfied`: a read showed the expectation before the deadline. `unsatisfied`: every read up to and including
 * one at the deadline showed otherwise. `unknown`: a read failed, so the state could not be read at all.
 */
export type Verdict =
	| { readonly status: "satisfied"; readonly reads: number; readonly elapsedMs: number }
	| { readonly status: "unsatisfied"; readonly reads: number; readonly elapsedMs: number }
	| { readonly status: "unknown"; readonly reads: number; readonly elapsedMs: number; readonly cause: unknown };
