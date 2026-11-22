import type { Action, EngineCode, Expect, Mode, OsName, Persona, SignalId, Targeting, Toolkit } from "./vocabulary.ts"

export interface Route {
  readonly toolkit: Toolkit
  readonly action: Action
  readonly targeting: Targeting
  readonly mode: Mode
}

interface Declaration {
  readonly expect: Expect
  readonly declares: readonly SignalId[]
  readonly basis: string
}

export type DeclaredOs = Exclude<OsName, "fake">

export const PERSONA_OS: Readonly<Record<Persona, DeclaredOs>> = {
  macos: "macos",
  win32: "windows",
  x11: "x11",
  wayland: "wayland",
}

export const TOOLKITS: readonly Toolkit[] = ["native", "electron", "webview"]
export const ACTION_TARGETINGS: readonly (readonly [Action, Targeting])[] = [
  ["click", "ax"],
  ["click", "px"],
  ["typeText", "ax"],
  ["typeText", "px"],
  ["scroll", "ax"],
  ["scroll", "px"],
  ["drag", "px"],
  ["keyChord", "ax"],
  ["ax.setValue", "ax"],
  ["ax.perform", "ax"],
  ["menu.select", "ax"],
]
export const MODES: readonly Mode[] = ["background", "foreground"]

const PLAN = "plan omo-computer-use-ideal-state"
const LEASE = `${PLAN} IS-2, IS-3 (one visible, bounded foreground lease)`

const deliver = (basis: string): Declaration => ({ expect: { deliver: true }, declares: [], basis })
const refuse = (code: EngineCode, basis: string): Declaration => ({ expect: { refuse: [code] }, declares: [], basis })

function foreground(route: Route): Declaration {
  const moves = route.targeting === "px" || route.action === "drag"
  const declares: SignalId[] = ["key_focus", "window_raised", "activation", "typing"]
  return { expect: { deliver: true }, declares: moves ? [...declares, "pointer"] : declares, basis: LEASE }
}

function macos(route: Route): Declaration {
  const web = route.toolkit !== "native"
  switch (route.action) {
    case "drag":
      return web
        ? refuse("BackgroundUnavailable", `${PLAN} row 21 (c): a system drag session needs the real pointer`)
        : deliver(`${PLAN} row 21 (c): native drag reorder in the background`)
    case "menu.select":
      return deliver(`${PLAN} row 21 (b): selectByTitle without opening the menu`)
    case "ax.setValue":
      return web
        ? refuse("AxUnconfirmed", `${PLAN} ADP-20, ADP-23: a web-area value write is not a receipt`)
        : deliver("design d-macos.md 6.5: AXValue set with read-back")
    case "click":
    case "typeText":
    case "scroll":
    case "keyChord":
    case "ax.perform":
      return deliver(`${PLAN} rows 21 (a), 22: pid-routed background input that leaves window order alone`)
  }
}

function windows(route: Route): Declaration {
  const chromium = route.toolkit !== "native"
  if (route.action === "keyChord")
    return refuse("BackgroundUnavailable", "design d-windows.md:152: posted modifier chord")
  if (route.action === "drag")
    return refuse("BackgroundUnavailable", "design d-windows.md:133: posted drag gated by the matrix")
  if (!chromium) return deliver(`${PLAN} row 28: classic Win32 and WinForms posted and UIA routes`)
  if (route.targeting === "px")
    return refuse("BackgroundUnavailable", "design d-windows.md:142, 157: posted input to Chromium")
  if (route.action === "menu.select") {
    return refuse("BackgroundUnavailable", "design d-macos.md 6.4 mirror in d-windows.md: a popup-opening control")
  }
  return deliver(`${PLAN} row 28: semantic-first UI Automation patterns with read-back`)
}

function x11(route: Route): Declaration {
  if (route.action === "ax.setValue" && route.toolkit !== "native") {
    return refuse("AxUnconfirmed", `${PLAN} ADP-20, ADP-23: a web-area value write is not a receipt`)
  }
  return deliver(`${PLAN} row 30: the second pointer and keyboard route on by default behind its preflight`)
}

function wayland(route: Route): Declaration {
  const ax_only = `${PLAN} row 34: stock compositors read backgroundReach ax_only`
  if (route.targeting === "px" || route.action === "drag" || route.action === "keyChord") {
    return refuse("BackgroundUnavailable", ax_only)
  }
  if (route.toolkit !== "native" && (route.action === "typeText" || route.action === "ax.setValue")) {
    return refuse("AxUnconfirmed", `${PLAN} ADP-20, ADP-23: a web-area value write is not a receipt`)
  }
  return deliver(`${PLAN} row 32: accessibility actions and verified writes (ADP-15, ADP-41)`)
}

const BACKGROUND: Readonly<Record<DeclaredOs, (route: Route) => Declaration>> = { macos, windows, x11, wayland }

export function declare(os: DeclaredOs, route: Route): Declaration {
  return route.mode === "foreground" ? foreground(route) : BACKGROUND[os](route)
}
