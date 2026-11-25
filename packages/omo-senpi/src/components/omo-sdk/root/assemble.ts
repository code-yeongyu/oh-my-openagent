import { type Namespace, type OmoSdkRoot, type OmoStream, ROOT_CALLS, type RootCallKey } from "../contract"
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

function loaded(key: RootCallKey, context: CoreContext, loaders: CoreLoaders): Call | undefined {
  const [namespace, ...rest] = key.split(".") as [Namespace, ...string[]]
  const loader = (loaders as Readonly<Record<string, (context: CoreContext) => Promise<Node>>>)[namespace]
  if (loader === undefined) return undefined
  let core: Promise<Node> | undefined
  const target = async (): Promise<Call> => {
    core ??= loader(context)
    const member = (await core)[rest.join(".")]
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
  for (const key of Object.keys(ROOT_CALLS) as RootCallKey[]) {
    const served = servings.find((serving) => serving.members[key] !== undefined)?.members[key]
    place(tree, key, served ?? loaded(key, context, loaders) ?? notImplemented(key))
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
