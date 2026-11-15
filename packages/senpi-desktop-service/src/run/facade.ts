import { randomUUID } from "node:crypto"
import { DESKTOP_METHODS, DISPLAY_METHODS, type DesktopCapabilities } from "@oh-my-opencode/senpi-desktop-protocol"
import type { Window as SdkWindow } from "@oh-my-opencode/senpi-desktop-sdk"
import { isRecord } from "../service/parse"
import { ComputerRunError, facadeMethod, openSdk, type RunScope, viaSdk } from "./context"
import {
  type DesktopDisplay,
  type DesktopWindow,
  expectResult,
  isAxNode,
  isExecResult,
  isText,
  optional,
} from "./engine-results"
import { ElementHandle, InputTarget, RUN_REPLY_GUARDS, resolveElement, WindowHandle } from "./handles"

export interface WindowFilter {
  /** Case-insensitive substring of the owning app name. */
  readonly app?: string
  /** Case-insensitive substring of the window title. */
  readonly title?: string
}

/** The SDK selector of a run filter: an empty field matches every window, as it always has here. */
function sdkFilter(filter: WindowFilter = {}): { readonly app?: string; readonly title?: string } {
  return { ...(filter.app ? { app: filter.app } : {}), ...(filter.title ? { title: filter.title } : {}) }
}

/** A window the SDK matched, paired with the engine's own record of it (user code sees the record unchanged). */
interface MatchedWindow {
  readonly record: DesktopWindow
  readonly window: SdkWindow
}

/**
 * The `desktop` global of a computer run (and the root of direct `call` chains): one engine target plus lookups.
 * Lookups run through the `@oh-my-opencode/senpi-desktop-sdk` `Computer` over this run's engine channel.
 */
export function createDesktopFacade(scope: RunScope) {
  const method = facadeMethod(scope, DESKTOP_METHODS)
  const matching = (selector: string | WindowFilter | undefined): Promise<readonly MatchedWindow[]> =>
    viaSdk("windows", async () => {
      const sdk = await openSdk(scope, RUN_REPLY_GUARDS)
      const windows = await sdk.computer.windows(typeof selector === "string" ? { id: selector } : sdkFilter(selector))
      const byId = new Map(windows.map((window) => [window.id, window]))
      return (sdk.reply("windows") as readonly DesktopWindow[]).flatMap((record) => {
        const window = byId.get(record.id)
        return window === undefined ? [] : [{ record, window }]
      })
    })
  const handle = ({ record, window }: MatchedWindow) => new WindowHandle(scope, record, window)
  const element = async (
    engineMethod: "ax.elementAt" | "ax.focused",
    params: object,
  ): Promise<ElementHandle | null> => {
    const node = expectResult(engineMethod, await scope.call(engineMethod, params), optional(isAxNode))
    return node === null ? null : new ElementHandle(scope, node)
  }
  const root = new InputTarget(scope, "desktop", DESKTOP_METHODS)
  return {
    capabilities: (): Promise<DesktopCapabilities> =>
      method("capabilities", () =>
        viaSdk("capabilities", async () => {
          const capabilities = await (await openSdk(scope, RUN_REPLY_GUARDS)).computer.capabilities()
          return { ...capabilities, cursorOverlay: capabilities.cursorOverlay ?? false }
        }),
      ),
    displays: (): Promise<readonly DesktopDisplay[]> =>
      method("displays", () =>
        viaSdk("displays", async () => {
          const sdk = await openSdk(scope, RUN_REPLY_GUARDS)
          await sdk.computer.displays()
          return sdk.reply("displays") as readonly DesktopDisplay[]
        }),
      ),
    /** A per-call display target, without changing the session's default capture; the engine refuses an unknown id at first use. */
    display: (selector: string): Promise<InputTarget & { readonly id: string }> =>
      method("display", async () => {
        if (typeof selector !== "string" || selector.length === 0)
          throw new ComputerRunError("assertion", "display requires an id, 'active', or 'all'")
        return Object.assign(new InputTarget(scope, `display:${selector}`, DISPLAY_METHODS), { id: selector })
      }),
    windows: (filter?: WindowFilter): Promise<readonly DesktopWindow[]> =>
      method("windows", async () => (await matching(filter ?? {})).map(({ record }) => record)),
    /** Exactly one window by opaque id or filter; an ambiguous filter throws listing the candidates. */
    window: (selector: string | WindowFilter): Promise<WindowHandle> =>
      method("window", async () => {
        const found = await matching(selector)
        const [only, ...others] = found
        if (only === undefined) throw new ComputerRunError("window", `no window matches ${JSON.stringify(selector)}`)
        if (others.length > 0) {
          const candidates = found.map(({ record }) => `${record.id} ${record.app} ${JSON.stringify(record.title)}`)
          throw new ComputerRunError(
            "window",
            `multiple windows match ${JSON.stringify(selector)}:\n${candidates.join("\n")}`,
          )
        }
        return handle(only)
      }),
    focusedWindow: (): Promise<WindowHandle | null> =>
      method("focusedWindow", async () => {
        const focused = (await matching({})).find(({ window }) => window.focused)
        return focused === undefined ? null : handle(focused)
      }),
    screenshot: root.screenshot.bind(root),
    zoom: root.zoom.bind(root),
    click: root.click.bind(root),
    doubleClick: root.doubleClick.bind(root),
    move: root.move.bind(root),
    drag: root.drag.bind(root),
    scroll: root.scroll.bind(root),
    type: root.type.bind(root),
    press: root.press.bind(root),
    holdKeys: root.holdKeys.bind(root),
    holdMouse: root.holdMouse.bind(root),
    /** The element under a point in global logical desktop coordinates (not screenshot pixels). */
    elementAt: (x: number, y: number): Promise<ElementHandle | null> =>
      method("elementAt", () => element("ax.elementAt", { target: "desktop", x, y })),
    focusedElement: (): Promise<ElementHandle | null> => method("focusedElement", () => element("ax.focused", {})),
    ref: (ref: string): Promise<ElementHandle> => method("ref", (run) => resolveElement(run, ref)),
    clipboard: {
      read: (): Promise<string> =>
        method(
          "clipboard.read",
          async ({ call }) => expectResult("clipboard.read", await call("clipboard.read", {}), isText).text,
        ),
      write: (text: string): Promise<void> =>
        method("clipboard.write", async ({ call }) => {
          expectResult("clipboard.write", await call("clipboard.write", { text }), isExecResult)
        }),
    },
    control: createControlFacade(scope, method),
  }
}

/** Run time kept back from a pending confirm for `control.grant` and the action that follows it. */
const CONFIRM_RUN_MARGIN_MS = 5_000
/** Less than this left for the confirm: a human could not read and answer it, so nobody is asked. */
const MIN_CONFIRM_BUDGET_MS = 3_000

/** The `control.state` result shape, mirrored from the engine's `ControlStateResult` (#9651 B5). */
export interface ControlState {
  readonly active: boolean
  readonly reason?: string | null
  readonly grantedAt?: string | null
}

function isControlState(value: unknown): value is ControlState {
  return isRecord(value) && typeof value.active === "boolean"
}

/**
 * `desktop.control`: the foreground-control grant. `acquire` asks the human through the run's confirm
 * channel and only then calls the host-only `control.grant`; a "yes" that arrives after the run was
 * aborted is discarded (the fence oh-my-pi's `#controlEpoch` guards, here the run's own signal).
 */
function createControlFacade(scope: RunScope, method: ReturnType<typeof facadeMethod>) {
  const state = (): Promise<ControlState> =>
    method("control.state", async ({ call }) =>
      expectResult("control.state", await call("control.state", {}), isControlState),
    )
  return {
    acquire: (options: { reason: string }): Promise<ControlState> =>
      method("control.acquire", async ({ context, call }) => {
        const reason = typeof options?.reason === "string" ? options.reason.trim() : ""
        if (reason.length === 0) {
          throw new ComputerRunError("assertion", "control.acquire requires a non-empty reason")
        }
        const current = expectResult("control.state", await call("control.state", {}), isControlState)
        if (current.active) return current
        const confirm = scope.confirmControl
        if (confirm === undefined) return { active: false }
        // The confirm must settle before the run budget ends, leaving time to send the grant and act on it.
        const budgetMs = Math.max(0, context.deadline - Date.now() - CONFIRM_RUN_MARGIN_MS)
        if (budgetMs < MIN_CONFIRM_BUDGET_MS) {
          throw new ComputerRunError(
            "assertion",
            "control.acquire needs at least 8 s of run time left (time for the human to answer, then to act); call it earlier or give the run a longer timeout",
          )
        }
        const approved = await confirm(reason, context.signal, budgetMs)
        context.signal.throwIfAborted()
        if (approved !== true) return { active: false }
        return expectResult(
          "control.grant",
          await call("control.grant", { reason, confirmationId: randomUUID() }),
          isControlState,
        )
      }),
    release: (): Promise<void> =>
      method("control.release", async ({ call }) => {
        await call("control.revoke", {})
      }),
    state,
  }
}

export type DesktopFacade = ReturnType<typeof createDesktopFacade>
