import type { Namespace, OmoPrincipal, OmoSdkRoot, RootCallKey } from "../contract"

type At<Node, Key extends string> = Key extends `${infer Head}.${infer Rest}`
  ? Head extends keyof Node
    ? At<Node[Head], Rest>
    : never
  : Key extends keyof Node
    ? Node[Key]
    : never

/** The member of the root type that one registry key names, so a namespace's implementation is checked against it. */
export type MemberOf<Key extends RootCallKey> = At<OmoSdkRoot, Key>

/** What one namespace module serves: a member per call it implements; every call it leaves out answers not_implemented. */
export type Members = { readonly [Key in RootCallKey]?: MemberOf<Key> }

/** One namespace module of the root: the calls it serves and how its core is released. */
export type NamespaceServing = {
  readonly members: Members
  /** Synchronous: aborts what is in flight, as `close()` does today. */
  readonly close?: () => void
  /** Releases what the core holds (the gateway store, the remote sessions). */
  readonly dispose?: () => Promise<void>
}

/** What a core loader is handed: the root's own fixed facts, never a per-call input. */
export type CoreContext = {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly cwd: string
  readonly home?: string
  readonly principal: OmoPrincipal
}

/** A namespace's calls keyed by the part after the namespace (`diagnostics.run` is `run`), each typed by the root type. */
export type NamespaceCore<N extends Namespace> = {
  readonly [Key in RootCallKey as Key extends `${N}.${infer Rest}` ? Rest : never]?: MemberOf<Key>
}

/**
 * A core that lives outside this package (the launcher library's diagnostics and install cores, design 3.1), supplied
 * by the entry that can import it. The loader runs on the namespace's first call, so building the root imports nothing.
 */
export type CoreLoader<N extends Namespace> = (context: CoreContext) => Promise<NamespaceCore<N>>

/** The namespaces whose core lives in the launcher library; every other namespace's core is this component's own. */
export const LAUNCHER_NAMESPACES = ["diagnostics", "install"] as const satisfies readonly Namespace[]
export type LauncherNamespace = (typeof LAUNCHER_NAMESPACES)[number]

/** A loader adds a launcher-side namespace; it never replaces a core this component serves itself. */
export type CoreLoaders = { readonly [N in LauncherNamespace]?: CoreLoader<N> }
