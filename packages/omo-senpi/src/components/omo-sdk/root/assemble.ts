import type { Namespace, OmoSdkRoot, OmoStream, RootCallKey } from "../contract"
import { ROOT_CALLS } from "../contract/calls"
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
      core ??= loader(context)
      try {
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
  if (ROOT_CALLS[key].answer === "stream")
    return (...args) => lazyStream(async () => (await target())(...args) as OmoStream<unknown, unknown>)
  return async (...args) => (await target())(...args)
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
): OmoSdkRoot {
  const tree: Node = {}
  const loads = namespaceLoads(loaders, context)
  for (const key of Object.keys(ROOT_CALLS) as RootCallKey[]) {
    const served = servings.find((serving) => serving.members[key] !== undefined)?.members[key]
    place(tree, key, served ?? loaded(key, loads) ?? notImplemented(key))
  }
  const close = (): void => {
    for (const serving of servings) serving.close?.()
  }
  const dispose = async (): Promise<void> => {
    close()
    await Promise.all(servings.map((serving) => serving.dispose?.()))
  }
  return Object.assign(tree, { close, dispose }) as unknown as OmoSdkRoot
}
