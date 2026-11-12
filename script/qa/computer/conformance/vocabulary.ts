import { z } from "zod"

/** The eight disturbance signals, the same columns as the sentinel of row 3 and the action report. */
export const SIGNAL_IDS = [
  "key_focus",
  "window_raised",
  "typing",
  "pointer",
  "clipboard",
  "space",
  "dialog",
  "activation",
] as const
export type SignalId = (typeof SIGNAL_IDS)[number]

/** The closed engine code table of `crates/omo-computer-core/src/error/code.rs` (`EngineCode`), in ordinal order. */
const ENGINE_CODES = [
  "PermissionDenied",
  "CaptureFailed",
  "InputFailed",
  "BackgroundUnavailable",
  "WindowNotFound",
  "InvalidTarget",
  "InvalidKey",
  "InvalidCoordinateFrame",
  "StaleRef",
  "AxUnsupported",
  "AxFailed",
  "Timeout",
  "Closed",
  "Internal",
  "StopPathUnavailable",
  "Suspended",
  "ScreenLocked",
  "Cancelled",
  "CursorRestoreFailed",
  "FocusRestoreFailed",
  "TransactionFailed",
  "InputBusy",
  "ControlRequired",
  "CaptureUnavailable",
  "UserIntervened",
  "AxUnconfirmed",
  "SpaceUnsupported",
  "SpaceMoveDenied",
  "AmbiguousTarget",
  "CaptureConsentRequired",
  "ProtectedProcess",
  "SessionInactive",
  "ConsequentialAction",
] as const
export type EngineCode = (typeof ENGINE_CODES)[number]

export const OS_NAMES = ["fake", "macos", "windows", "x11", "wayland"] as const
export type OsName = (typeof OS_NAMES)[number]
/** The fake backend's per-OS personas (cu-v3 row 14); a fake cell mirrors the declaration of its persona's OS. */
export type Persona = "macos" | "win32" | "x11" | "wayland"
export type Toolkit = "native" | "electron" | "webview"
export type Action =
  "click" | "typeText" | "scroll" | "drag" | "keyChord" | "ax.setValue" | "ax.perform" | "menu.select"
export type Targeting = "ax" | "px"
export type Mode = "background" | "foreground"
export type Expect = { readonly deliver: true } | { readonly refuse: readonly EngineCode[] }

/** A field of the fixture app's own report (`FixtureReport`, design d-test-qa.md D5) and the value that proves the effect. */
type FixtureField = "value" | "receivedKeys" | "pressCount" | "scrollSteps" | "dragOrder" | "menuSelection"
export interface Oracle {
  readonly field: FixtureField
  readonly equals: string | number
}

export interface Cell {
  readonly os: OsName
  readonly session: string
  readonly persona?: Persona
  readonly toolkit: Toolkit
  readonly action: Action
  readonly targeting: Targeting
  readonly mode: Mode
  readonly expect: Expect
  /** The signals a delivered foreground cell may change; a background or refusal cell declares none. */
  readonly declares: readonly SignalId[]
  readonly oracle: Oracle
  /** Where the ideal-state plan or the design pin declares this outcome. */
  readonly basis: string
}

const signalSummary = z.object({
  signal: z.enum(["none", "happened"]),
  firstAt: z.number().nullable(),
  count: z.number().int().nonnegative(),
})
export type SignalSummary = z.infer<typeof signalSummary>

const observed = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("delivered") }),
  z.object({ kind: z.literal("refused"), code: z.string(), nothingSent: z.boolean() }),
  z.object({ kind: z.literal("error"), message: z.string() }),
  z.object({ kind: z.literal("not_run"), reason: z.string() }),
])

const cellResultSchema = z.object({
  id: z.string(),
  observed,
  oracle: z.object({ observed: z.unknown() }),
  durationMs: z.number().nonnegative(),
  journal: z.object({
    key_focus: signalSummary,
    window_raised: signalSummary,
    typing: signalSummary,
    pointer: signalSummary,
    clipboard: signalSummary,
    space: signalSummary,
    dialog: signalSummary,
    activation: signalSummary,
  }),
})
export type CellResult = z.infer<typeof cellResultSchema>

export const RUN_SCHEMA = "omo-conformance-run/1"
export const runFileSchema = z.object({
  schema: z.literal(RUN_SCHEMA),
  driver: z.enum(["engine", "legacy"]),
  os: z.enum(OS_NAMES),
  session: z.string(),
  results: z.array(cellResultSchema),
})
