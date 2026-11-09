import { createEventBus, createExtensionRuntime, loadExtensionFromFactory } from "../senpi-test-runtime"

export type SeamEdit = { readonly hide?: readonly string[]; readonly add?: Readonly<Record<string, unknown>> }

// A view of a real senpi ExtensionAPI that hides or adds named seams; a dotted name (`rpc.handle`) reaches into its parent.
export function withSeamEdit(surface: object, edit: SeamEdit): object {
  const hide = edit.hide ?? []
  const add = edit.add ?? {}
  const view = (target: object, prefix: string): object => new Proxy(target, {
    has: (holder, key) => typeof key !== "string" ? Reflect.has(holder, key) : `${prefix}${key}` in add || (!hide.includes(`${prefix}${key}`) && Reflect.has(holder, key)),
    get: (holder, key) => {
      if (typeof key !== "string") return Reflect.get(holder, key)
      const path = `${prefix}${key}`
      if (path in add) return add[path]
      if (hide.includes(path)) return undefined
      const value: unknown = Reflect.get(holder, key)
      return typeof value === "object" && value !== null && hide.some((hidden) => hidden.startsWith(`${path}.`)) ? view(value, `${path}.`) : value
    },
  })
  return view(surface, "")
}

export async function loadWithPinnedSenpi(cwd: string, factory: (pi: object) => void | Promise<void>): Promise<void> {
  await loadExtensionFromFactory(async (pi) => {
    if (typeof pi !== "object" || pi === null) throw new Error("senpi passed the extension no API object")
    await factory(pi)
  }, cwd, createEventBus(), createExtensionRuntime())
}
