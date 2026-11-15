/**
 * The `computer` bridge of the QuickJS run cell (docs/reference/computer-run-sandbox-threat-model.md section 4):
 * the VM holds stubs generated from the four facade method tables, and every stub call is one bridged call that
 * runs the same run facade the vm mode uses (`facadeMethod` -> `guardRun` -> the engine), one at a time.
 *
 * Arguments arrive as JSON and are passed to the facade method as they are, never merged into a host object; a
 * trailing `undefined` argument is dropped in the VM, so it stays absent, and a non-trailing one arrives as `null`.
 * A result crosses back as JSON through an explicit replacer: a window, element or display handle becomes a
 * descriptor (a handle number plus its snapshot fields) that the VM turns into a stub, and a value JSON cannot
 * carry faithfully (non-finite number, bigint, function, symbol) is refused. A result that is `undefined` crosses
 * as a settle without a payload, which the VM resolves as `undefined`; an `undefined` nested in a result follows
 * JSON (an object property is dropped, an array element becomes `null`).
 */
import { randomUUID } from "node:crypto"
import {
  type ComputerScreenshot,
  type ComputerSessionSnapshot,
  DESKTOP_METHODS,
  DISPLAY_METHODS,
  ELEMENT_METHODS,
  type EngineMethod,
  WINDOW_METHODS,
} from "@oh-my-opencode/senpi-desktop-protocol"
import { ComputerRunError, type ConfirmControl, type MethodTiers, type RunOutput, type RunScope } from "../context"
import { createDesktopFacade } from "../facade"
import { ElementHandle, WindowHandle } from "../handles"
import { InputTarget } from "../input-target"
import type { SandboxSetup } from "./protocol"
import { BridgedJson, type SandboxBridgedCall } from "./quickjs"

/** Distinct handles (by engine identity) one run may hold; past it the call that would add one rejects. */
const SANDBOX_MAX_HANDLES = 10_000

/** The VM global the stubs call through; the setup replaces it with the stub namespace. */
const BRIDGE_NAME = "computer"

type HandleKind = "desktop" | "window" | "element" | "display"

const TABLES: Readonly<Record<HandleKind, MethodTiers>> = {
  desktop: DESKTOP_METHODS,
  window: WINDOW_METHODS,
  element: ELEMENT_METHODS,
  display: DISPLAY_METHODS,
}

// VM side. `data` is JSON `{ marker, tables }`: the per-run key of a handle descriptor and the method names of
// each kind. A dotted name (`clipboard.read`) becomes a nested namespace. Results are revived in place: a
// descriptor becomes a stub (its snapshot fields plus its kind's methods), everything else stays the parsed JSON.
const SETUP_SOURCE = `(callHost, data) => {
	const { marker, tables } = JSON.parse(data);
	const revive = (value) => {
		if (value === null || typeof value !== "object") return value;
		if (Array.isArray(value)) {
			for (let i = 0; i < value.length; i++) value[i] = revive(value[i]);
			return value;
		}
		if (Object.hasOwn(value, marker)) {
			const { kind, handle, fields } = value[marker];
			return Object.assign(fields, namespace(handle, tables[kind]));
		}
		for (const key of Object.keys(value)) value[key] = revive(value[key]);
		return value;
	};
	const namespace = (target, names) => {
		const root = {};
		for (const name of names) {
			const path = name.split(".");
			const leaf = path.pop();
			let node = root;
			for (const part of path) node = Object.hasOwn(node, part) ? node[part] : (node[part] = {});
			node[leaf] = (...args) => {
				// The method's own arguments are nested, so callHost cannot drop their trailing undefined; drop it here.
				while (args.length > 0 && args[args.length - 1] === undefined) args.pop();
				return callHost(${JSON.stringify(BRIDGE_NAME)}, [target, name, args]).then(revive);
			};
		}
		return root;
	};
	globalThis.computer = globalThis.desktop = namespace(0, tables.desktop);
}`

export interface ComputerBridgeHost {
  readonly snapshot: ComputerSessionSnapshot
  /** Epoch ms when the run budget ends (`control.acquire` keeps its confirm inside it). */
  readonly deadline: number
  /** Shared with the cell's console output, so a screenshot shows in order with it. */
  readonly output: RunOutput
  /** Artifacts written during the run; appended by `screenshot()`. */
  readonly screenshots: ComputerScreenshot[]
  /** One engine request, carrying the run signal. */
  readonly call: (method: EngineMethod, params: object, signal: AbortSignal) => Promise<unknown>
  readonly confirmControl?: ConfirmControl
}

export interface ComputerBridge {
  readonly bridge: Readonly<Record<string, SandboxBridgedCall>>
  readonly setup: SandboxSetup
}

interface HandleEntry {
  readonly kind: HandleKind
  readonly target: object
}

function refused(what: string): TypeError {
  return new TypeError(`computer run: a ${what} cannot cross the sandbox boundary`)
}

/** The bridge of one run: its own facade, its own handle table, its own descriptor marker. */
export function createComputerBridge(host: ComputerBridgeHost): ComputerBridge {
  const marker = `$handle:${randomUUID()}`
  // Index 0 is the `desktop` root; stubs name their handle by index, handles are keyed by engine identity.
  const entries: HandleEntry[] = []
  const indexByIdentity = new Map<string, number>()
  let root: HandleEntry | undefined

  // The facade is built on the first call, from the run signal the cell passes with it.
  const rootFor = (signal: AbortSignal): HandleEntry => {
    if (root !== undefined) return root
    const scope: RunScope = {
      context: {
        signal,
        readOnly: host.snapshot.readOnly,
        snapshot: host.snapshot,
        output: host.output,
        screenshots: host.screenshots,
        deadline: host.deadline,
      },
      call: (method, params) => host.call(method, params, signal),
      // Nothing to resume: the cell resumes the VM when the bridged call settles.
      resume: (promise) => promise,
      ...(host.confirmControl === undefined ? {} : { confirmControl: host.confirmControl }),
    }
    root = { kind: "desktop", target: createDesktopFacade(scope) }
    entries[0] = root
    return root
  }

  const descriptor = (kind: HandleKind, identity: string, target: object, fields: object): object => {
    let handle = indexByIdentity.get(identity)
    if (handle === undefined) {
      if (indexByIdentity.size >= SANDBOX_MAX_HANDLES) {
        throw new ComputerRunError(
          "resultSize",
          `computer run: the result would hold more than ${SANDBOX_MAX_HANDLES} distinct handles`,
        )
      }
      handle = entries.length
      indexByIdentity.set(identity, handle)
    }
    entries[handle] = { kind, target }
    return { [marker]: { kind, handle, fields } }
  }

  const replacer = (_key: string, value: unknown): unknown => {
    if (value instanceof WindowHandle) {
      const { id, app, title, pid, bounds, focused } = value
      return descriptor("window", `window:${id}`, value, { id, app, title, pid, bounds, focused })
    }
    if (value instanceof ElementHandle) {
      const { ref, role, nativeRole, title, description, enabled, focused, childCount } = value
      const fields = { ref, role, nativeRole, title, description, enabled, focused, childCount }
      return descriptor("element", `element:${ref}`, value, fields)
    }
    if (value instanceof InputTarget) {
      const { id } = value as InputTarget & { readonly id?: unknown }
      if (typeof id !== "string") throw refused("handle without an id")
      return descriptor("display", `display:${id}`, value, { id })
    }
    switch (typeof value) {
      case "bigint":
      case "function":
      case "symbol":
        throw refused(typeof value)
      case "number":
        if (!Number.isFinite(value)) throw refused("non-finite number")
        return value
      default:
        return value
    }
  }

  const call: SandboxBridgedCall = async (args, signal) => {
    const [handle, method, methodArgs] = args
    if (typeof handle !== "number" || typeof method !== "string" || !Array.isArray(methodArgs)) {
      throw new TypeError("computer run: malformed bridged call")
    }
    const entry = handle === 0 ? rootFor(signal) : entries[handle]
    if (entry === undefined) throw new TypeError(`computer run: unknown handle ${handle}`)
    const tiers = TABLES[entry.kind]
    if (!Object.hasOwn(tiers, method)) throw new TypeError(`computer run: unknown ${entry.kind} method '${method}'`)
    const path = method.split(".")
    const leaf = path.pop() as string
    let holder: unknown = entry.target
    for (const part of path) holder = (holder as Record<string, unknown>)[part]
    const fn = (holder as Record<string, unknown>)[leaf]
    if (typeof fn !== "function") throw new TypeError(`computer run: ${entry.kind} method '${method}' is not callable`)
    // The arguments are the parsed JSON itself: data handed to the facade method, never merged into host state.
    const value: unknown = await Reflect.apply(fn, holder, methodArgs)
    return value === undefined ? undefined : new BridgedJson(JSON.stringify(value, replacer))
  }

  const tables: Record<HandleKind, readonly string[]> = {
    desktop: Object.keys(DESKTOP_METHODS),
    window: Object.keys(WINDOW_METHODS),
    element: Object.keys(ELEMENT_METHODS),
    display: Object.keys(DISPLAY_METHODS),
  }
  return {
    bridge: { [BRIDGE_NAME]: call },
    setup: { source: SETUP_SOURCE, data: JSON.stringify({ marker, tables }) },
  }
}
