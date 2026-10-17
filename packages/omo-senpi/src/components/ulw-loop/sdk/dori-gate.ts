/**
 * The switch for the agent toolkit's layer-2 namespaces, which a separately installed dori host fills.
 * omo carries no dori behavior: with the `dori` config section absent or switched off, the engine
 * clears the kernel flag, the SDK adds no namespace property, and no layer module is imported.
 * A layer-2 function is a session tool the host's store extension declares (`ext_dori_<ns>_<fn>`,
 * dots in a nested function name written as underscores), so every call takes the engine-stamped
 * caller path of store extension session ops.
 */

/** Read by the agent toolkit SDK when a kernel imports it; "1" adds the namespaces. */
export const DORI_TOOLKIT_ENV = "OMO_DORI_TOOLKIT"

/** The store extension name the dori host registers its session ops under. */
export const DORI_STORE_EXTENSION = "dori"

export const DORI_TOOLKIT_NAMESPACES = ["route", "reply", "room", "send", "thread", "describe", "file", "rules", "iam", "call", "work"] as const

export type DoriToolkitNamespace = (typeof DORI_TOOLKIT_NAMESPACES)[number]

export function isDoriToolkitNamespace(value: string): value is DoriToolkitNamespace {
  return DORI_TOOLKIT_NAMESPACES.some((namespace) => namespace === value)
}

/** On when the section is an object and not `enabled: false`. */
export function isDoriSectionEnabled(section: unknown): boolean {
  if (typeof section !== "object" || section === null || Array.isArray(section)) return false
  return (section as { readonly enabled?: unknown }).enabled !== false
}

/** Publishes the decision to the kernels this engine starts; the config is the only source of truth. */
export function applyDoriToolkitGate(section: unknown, env: NodeJS.ProcessEnv): boolean {
  const enabled = isDoriSectionEnabled(section)
  if (enabled) env[DORI_TOOLKIT_ENV] = "1"
  else delete env[DORI_TOOLKIT_ENV]
  return enabled
}

/** The layer-2 op a declared session tool is (`reply_mark` -> `reply.mark`), or undefined for any other tool. */
export function doriLayer2Path(extension: string, toolName: string): { readonly namespace: DoriToolkitNamespace; readonly op: string } | undefined {
  if (extension !== DORI_STORE_EXTENSION) return undefined
  const [namespace, ...path] = toolName.split("_")
  if (namespace === undefined || path.length === 0 || !isDoriToolkitNamespace(namespace)) return undefined
  return { namespace, op: [namespace, ...path].join(".") }
}
