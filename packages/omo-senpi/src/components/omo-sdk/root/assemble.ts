import type { Namespace, OmoFailure, OmoSdkRoot, OmoStream, RootCallKey } from "../contract"
import { OMO_CODE_REGISTRY } from "../contract/codes"
import { ROOT_CALL_ANSWERS } from "../contract/call-answers"
import type { CoreContext, CoreLoaders, NamespaceServing } from "./members"
import { notImplemented } from "./not-implemented"

type Node = Record<string, unknown>
type Call = (...args: unknown[]) => unknown

function place(tree: Node, key: string, value: unknown): void {
  const parts = key.split(".")
  const leaf = parts.pop() as string
  let node = tree
  for (const part of parts) node = (node[part] ??= {}) as Node
  node[leaf] = value
}

// A stream member answers its stream synchronously, so a stream whose core loads on first use starts the load when it
// is first read and hands every event of the loaded call's stream through.
function lazyStream(open: () => Promise<OmoStream<unknown, unknown>>): OmoStream<unknown, unknown> {
  let stopped = false
  let opened: OmoStream<unknown, unknown> | undefined
  return {
    stop: () => {
      stopped = true
      opened?.stop()
    },
    async *[Symbol.asyncIterator]() {
      opened = await open()
      if (stopped) opened.stop()
      yield* opened
    },
  }
}

type Load = () => Promise<Node | undefined>

// One load per namespace, shared by all its members, so concurrent first calls load the core once. A load that fails is
// not kept: that call answers internal_error and the next call loads again.
function namespaceLoads(loaders: CoreLoaders, context: CoreContext): ReadonlyMap<string, Load> {
  const loads = new Map<string, Load>()
  for (const [namespace, loader] of Object.entries(
    loaders as Readonly<Record<string, (context: CoreContext) => Promise<Node>>>,
  )) {
    let core: Promise<Node> | undefined
    loads.set(namespace, async () => {
      try {
        core ??= loader(context)
        return await core
      } catch {
        core = undefined
        return undefined
      }
    })
  }
  return loads
}

const loadFailure = (namespace: string) => async () => ({
  kind: "error",
  error: {
    code: "internal_error",
    message: `The ${namespace} core could not be loaded.`,
    next_action: "Call it again; if it fails again, reinstall omo.",
  },
})

// Every boundary refusal (no line, a refused line, an invalid input) is handed to the namespaces that record refusals
// (refused, with the reason code, never the input) before it is answered.
function refusing(key: RootCallKey, error: OmoFailure["error"], servings: readonly NamespaceServing[]): Call {
  const record = () =>
    Promise.all(servings.map((serving) => serving.recordRefusal?.(key, error.code)?.catch(() => undefined)))
  if (ROOT_CALL_ANSWERS[key] !== "stream")
    return async () => {
      await record()
      return { kind: "error", error }
    }
  return () => ({
    stop: () => undefined,
    async *[Symbol.asyncIterator]() {
      await record()
      yield { kind: "end", failure: error }
    },
  })
}

/** Design 4.4 and the design lane's ruling: an input outside its call's schema is refused before the member runs. */
export const invalidInput = (key: RootCallKey): OmoFailure["error"] => ({
  code: "invalid_arguments",
  message: `The input of ${key} does not match its schema.`,
  next_action: OMO_CODE_REGISTRY.invalid_arguments.next_action,
})

/**
 * Calls whose unknown top-level input keys are dropped before the schema check, as their shipped members ignore them
 * today (design lane ruling on closed schemas). Closed list: slice P1a's follow-up fills it and pins each call; whether
 * such a key should be refused instead is a later, recorded decision.
 */
const UNKNOWN_KEYS_DROPPED: readonly RootCallKey[] = []

/** The input as its schema sees it: for a call in the list, only the keys the schema names. */
async function checkedInput(key: RootCallKey, input: Record<string, unknown>): Promise<unknown> {
  if (!UNKNOWN_KEYS_DROPPED.includes(key)) return input
  const { ROOT_CALLS } = await import("../contract/calls")
  const named = Object.keys((ROOT_CALLS[key].input as { readonly properties?: object }).properties ?? {})
  return Object.fromEntries(Object.entries(input).filter(([field]) => named.includes(field)))
}

/**
 * A call's input is a plain object: its prototype is Object.prototype or null. A Date, a Map, a boxed string or a class
 * instance would satisfy a schema with no required field as if it were the empty input, so the boundary refuses it, and
 * so is an object built in another realm (a vm context), whose prototype is that realm's own.
 */
const isPlainInput = (input: unknown): input is Record<string, unknown> => {
  if (typeof input !== "object" || input === null) return false
  try {
    if (Array.isArray(input)) return false
    const prototype: unknown = Object.getPrototypeOf(input)
    return prototype === Object.prototype || prototype === null
  } catch {
    return false
  }
}

/**
 * The boundary's one read of the caller's object: its own string-keyed fields, enumerable or not (the shipped
 * SignInOptions never required enumerable ones), and the plain objects and arrays inside them, each read once into a
 * copy, so neither the schema nor a member reads the caller's object again. Below the top level the same rule as at it:
 * a value where the schema asks for an object or array must be plain (or null-prototype) or an array; a non-plain value
 * is kept as it is only where the schema accepts any value or describes nothing (`inputShape`). Every read here may run
 * the caller's code (a proxy trap, a getter); a throw, a cycle or a nesting deeper than MAX_INPUT_DEPTH makes the input
 * malformed, answered with the fixed refusal and never the thrown text (review 6075306724; the security read of
 * b01f3fbdd4, N1).
 */
export const ownCopy = (input: unknown, shape: InputShape): Record<string, unknown> | undefined => {
  if (!isPlainInput(input)) return undefined
  try {
    return copyFields(input, "", shape, new Set(), 0)
  } catch {
    return undefined
  }
}

/** The deepest plain nesting an input may have (the call table's schemas go 6 deep); deeper input is refused. */
const MAX_INPUT_DEPTH = 32

const childPath = (path: string, key: string) => (path === "" ? key : `${path}.${key}`)

/**
 * What the boundary needs of a call's input schema: the field paths it describes, and among them those that accept any
 * value. A path is a field name, `a.b` below it, `a[]` for an array's items and `a.*` for a pattern's keys.
 */
export type InputShape = {
  readonly described: ReadonlySet<string>
  readonly anyValue: ReadonlySet<string>
  readonly cloned: ReadonlySet<string>
}

// The any-value fields whose member clones the value with structuredClone (the store's extension facade does): the
// boundary makes that clone once, so every field is read there, a value that cannot be cloned answers the fixed
// invalid_arguments, and the member receives only the clone (LEAD ruling (1), the coordinator's direction of 20:38Z).
const CLONED_AT: Partial<Record<RootCallKey, readonly string[]>> = {
  "threads.extensions.call": ["args"],
  "threads.extensions.register": ["sessionCallable[].parameters.*"],
}

function copyFields(
  value: object,
  path: string,
  shape: InputShape,
  ancestors: Set<object>,
  depth: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const pattern = `${path}.*`
  for (const key of Object.getOwnPropertyNames(value)) {
    const at =
      shape.described.has(pattern) && !shape.described.has(childPath(path, key)) ? pattern : childPath(path, key)
    // Defined, never assigned, so a field named __proto__ stays a field.
    Object.defineProperty(out, key, {
      value: copyValue((value as Record<string, unknown>)[key], at, shape, ancestors, depth + 1),
      enumerable: true,
      writable: true,
      configurable: true,
    })
  }
  return out
}

// A non-plain value is kept as it is where the schema accepts any value, and where the schema describes nothing (an
// unknown key, which the schema or the call refuses by name, or a shipped convention such as deviceService.status's
// first-argument signal); where the schema describes an object or array it must be plain or an array.
function copyValue(value: unknown, path: string, shape: InputShape, ancestors: Set<object>, depth: number): unknown {
  if (shape.cloned.has(path)) return structuredClone(value)
  if (shape.anyValue.has(path)) return copyFree(value, ancestors, depth)
  if (typeof value !== "object" || value === null) return value
  const array = Array.isArray(value)
  if (!array && !isPlainInput(value)) {
    if (shape.described.has(path)) throw new Error("input_shape")
    return value
  }
  if (ancestors.has(value) || depth > MAX_INPUT_DEPTH) throw new Error("input_shape")
  ancestors.add(value)
  let copied: unknown
  if (array) {
    const items: unknown[] = []
    const length = (value as unknown[]).length
    for (let index = 0; index < length; index += 1)
      items.push(copyValue((value as unknown[])[index], `${path}[]`, shape, ancestors, depth + 1))
    copied = items
  } else copied = copyFields(value, path, shape, ancestors, depth)
  ancestors.delete(value)
  return copied
}

// Free data under a field that accepts any value (an extension's args, its tools' parameters): plain objects and arrays
// are copied all the way down, each field read once, so the member never reads the caller's object; any other value (a
// function, an AbortSignal, attachment bytes) is kept by identity, at any depth. The same cycle and depth refusal.
function copyFree(value: unknown, ancestors: Set<object>, depth: number): unknown {
  if (typeof value !== "object" || value === null) return value
  const array = Array.isArray(value)
  if (!array && !isPlainInput(value)) return value
  if (ancestors.has(value) || depth > MAX_INPUT_DEPTH) throw new Error("input_shape")
  ancestors.add(value)
  let copied: unknown
  if (array) {
    const items: unknown[] = []
    const length = (value as unknown[]).length
    for (let index = 0; index < length; index += 1)
      items.push(copyFree((value as unknown[])[index], ancestors, depth + 1))
    copied = items
  } else {
    const out: Record<string, unknown> = {}
    for (const key of Object.getOwnPropertyNames(value))
      Object.defineProperty(out, key, {
        value: copyFree((value as Record<string, unknown>)[key], ancestors, depth + 1),
        enumerable: true,
        writable: true,
        configurable: true,
      })
    copied = out
  }
  ancestors.delete(value)
  return copied
}

// A field path of the call's input schema that accepts any value: no type, union, constant or structure of its own. The
// list is closed and generated from the schemas (pinned by nested-input.test.ts), so a new one shows up in review.
const isAnyValue = (schema: Record<string, unknown>): boolean =>
  ["type", "anyOf", "oneOf", "allOf", "const", "enum", "properties", "items", "$ref", "not"].every(
    (field) => schema[field] === undefined,
  )

function collectShape(schema: unknown, path: string, described: Set<string>, anyValue: Set<string>): void {
  if (typeof schema !== "object" || schema === null) return
  const node = schema as Record<string, unknown>
  if (path !== "") described.add(path)
  if (path !== "" && isAnyValue(node)) {
    anyValue.add(path)
    return
  }
  for (const [key, child] of Object.entries((node["properties"] ?? {}) as object))
    collectShape(child, childPath(path, key), described, anyValue)
  for (const child of Object.values((node["patternProperties"] ?? {}) as object))
    collectShape(child, `${path}.*`, described, anyValue)
  if (typeof node["additionalProperties"] === "object")
    collectShape(node["additionalProperties"], `${path}.*`, described, anyValue)
  if (node["items"] !== undefined) collectShape(node["items"], `${path}[]`, described, anyValue)
  for (const branch of [node["anyOf"], node["oneOf"], node["allOf"]])
    if (Array.isArray(branch)) for (const child of branch) collectShape(child, path, described, anyValue)
}

const shapes = new Map<RootCallKey, InputShape>()
/** The input shape of a root call, from its schema: the paths it describes and those that accept any value. */
export async function inputShape(key: RootCallKey): Promise<InputShape> {
  const known = shapes.get(key)
  if (known !== undefined) return known
  const { ROOT_CALLS } = await import("../contract/calls")
  const described = new Set<string>()
  const anyValue = new Set<string>()
  collectShape(ROOT_CALLS[key].input, "", described, anyValue)
  const shape = { described, anyValue, cloned: new Set(CLONED_AT[key] ?? []) }
  shapes.set(key, shape)
  return shape
}

// The call table's schemas load on the first checked call, not when the root is built (design lane ruling on the
// runtime's cold import); contract/eager-tables.test.ts builds them all so a bad schema still fails in CI.
/** The copy a member receives, or undefined when the input is refused. */
export async function admitted(key: RootCallKey, input: unknown): Promise<Record<string, unknown> | undefined> {
  const own = ownCopy(input, await inputShape(key))
  if (own === undefined) return undefined
  const { inputAccepts } = await import("../contract/validate")
  // The schema reads only the copy: what it describes is copied plain data, and it reads nothing inside a value it
  // accepts as any, so no caller code runs here (the security read's M7).
  return inputAccepts(key, await checkedInput(key, own)) ? own : undefined
}

// An omitted input is the empty input and stays omitted for the member; any other value, null included, is checked as
// given and replaced by its copy.
async function admittedArgs(key: RootCallKey, args: readonly unknown[]): Promise<readonly unknown[] | undefined> {
  const own = await admitted(key, args[0] === undefined ? {} : args[0])
  if (own === undefined) return undefined
  return args[0] === undefined ? args : [own, ...args.slice(1)]
}

// A call with a shipped convention checks its own input; the root loads its shape first, so a dispose() that begins
// meanwhile answers the disposed refusal here too, before the member runs.
function legacyChecked(key: RootCallKey, member: Call, lifecycle: Lifecycle): Call {
  const disposed = refusing(key, ROOT_DISPOSED, [])
  return async (...args) => {
    const admission = inputShape(key)
    lifecycle.admitting(admission)
    await admission
    return lifecycle.isDisposed() ? disposed() : member(...args)
  }
}

/** The root's lifecycle as its calls see it: whether dispose() began, and the admissions still awaiting their input. */
type Lifecycle = {
  readonly isDisposed: () => boolean
  readonly admitting: (admission: Promise<unknown>) => void
}

function checked(key: RootCallKey, member: Call, servings: readonly NamespaceServing[], lifecycle: Lifecycle): Call {
  const refuse = refusing(key, invalidInput(key), servings)
  const disposed = refusing(key, ROOT_DISPOSED, [])
  const run = async (args: readonly unknown[]) => {
    const admission = admittedArgs(key, args)
    lifecycle.admitting(admission)
    const given = await admission
    // dispose() may have begun while the input was checked: the call then builds and reaches nothing.
    if (lifecycle.isDisposed()) return disposed()
    return given === undefined ? refuse() : member(...given)
  }
  if (ROOT_CALL_ANSWERS[key] === "stream")
    return (...args) => lazyStream(async () => (await run(args)) as OmoStream<unknown, unknown>)
  return async (...args) => run(args)
}

function loaded(key: RootCallKey, loads: ReadonlyMap<string, Load>): Call | undefined {
  const [namespace, ...rest] = key.split(".") as [Namespace, ...string[]]
  const load = loads.get(namespace)
  if (load === undefined) return undefined
  const target = async (): Promise<Call> => {
    const core = await load()
    if (core === undefined) return loadFailure(namespace)
    const member = core[rest.join(".")]
    return typeof member === "function" ? (member as Call) : notImplemented(key)
  }
  if (ROOT_CALL_ANSWERS[key] === "stream")
    return (...args) => lazyStream(async () => (await target())(...args) as OmoStream<unknown, unknown>)
  return async (...args) => (await target())(...args)
}

/** Design ruling on the disposed root: one answer for every call after close() or dispose(), fixed text. */
export const ROOT_DISPOSED: OmoFailure["error"] = {
  code: "internal_error",
  message: "This omo SDK root was disposed; create a new root.",
  next_action: "Create a new omo SDK root and call it again.",
  details: { reason: "root_disposed" },
}

// A disposed root refuses at its boundary, before the principal's line, the input, any member or port; nothing is
// recorded (no namespace is handed the refusal), since recording would reach a namespace's store. A call that entered
// before dispose() runs to its answer.
function openOnly(key: RootCallKey, call: Call, isDisposed: () => boolean): Call {
  const refuse = refusing(key, ROOT_DISPOSED, [])
  return (...args) => (isDisposed() ? refuse() : call(...args))
}

/**
 * The root object: every call of the root type, from the namespace module that serves it, else from the core the entry
 * supplies a loader for, else as not_implemented. The keys are computed, so the tree is assembled untyped and given its
 * type once here; each served member and each loaded core was already checked against its call's type (members.ts).
 */
export function assembleRoot(
  servings: readonly NamespaceServing[],
  loaders: CoreLoaders,
  context: CoreContext,
  refusals: ReadonlyMap<RootCallKey, OmoFailure["error"]>,
): OmoSdkRoot {
  const tree: Node = {}
  const loads = namespaceLoads(loaders, context)
  let disposed = false
  const pending = new Set<Promise<unknown>>()
  const lifecycle: Lifecycle = {
    isDisposed: () => disposed,
    admitting: (admission) => {
      pending.add(admission)
      void admission.finally(() => pending.delete(admission)).catch(() => undefined)
    },
  }
  for (const key of Object.keys(ROOT_CALL_ANSWERS) as RootCallKey[]) {
    const refused = refusals.get(key)
    const serving = servings.find((candidate) => candidate.members[key] !== undefined)
    const member = serving?.members[key] ?? loaded(key, loads)
    // The order of answers (design 4.4): a disposed root first, then the principal's line, then the input, then
    // availability, then the port; an unbuilt call checks its input before it answers not_implemented.
    const call =
      refused !== undefined
        ? refusing(key, refused, servings)
        : member === undefined
          ? checked(key, notImplemented(key), servings, lifecycle)
          : serving?.legacy?.includes(key) === true
            ? legacyChecked(key, member as Call, lifecycle)
            : checked(key, member as Call, servings, lifecycle)
    place(
      tree,
      key,
      openOnly(key, call, () => disposed),
    )
  }
  // close() keeps the shipped surface's behavior (its account calls answer closed, its local reads still answer); a
  // disposed root refuses every call (design ruling on the disposed root).
  const close = (): void => {
    for (const serving of servings) serving.close?.()
  }
  let disposing: Promise<void> | undefined
  // dispose() marks the root first, so no admission that completes later reaches a member, then waits for the admissions
  // still pending before it releases the namespaces' cores and ports.
  const dispose = (): Promise<void> => {
    disposed = true
    for (const serving of servings) serving.disposing?.()
    close()
    disposing ??= Promise.allSettled([...pending])
      .then(() => Promise.all(servings.map((serving) => serving.dispose?.())))
      .then(() => undefined)
    return disposing
  }
  return Object.assign(tree, { close, dispose }) as unknown as OmoSdkRoot
}
