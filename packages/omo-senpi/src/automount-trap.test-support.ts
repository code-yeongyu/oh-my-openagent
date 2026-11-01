import { spyOn } from "bun:test"
import * as nodeFs from "node:fs"
import * as nodeFsPromises from "node:fs/promises"

import { homedir, tmpdir } from "node:os"
import { posix } from "node:path"

import * as memoryFs from "@oh-my-opencode/memory-core/fs"

export const AUTOMOUNT_TRIGGER_CASES = [
  "/home",
  "/home/qa-other/work/SKILL.md",
  "/net/host/share/note.md",
  "/HOME/qa-other/work/note.md",
  "/System/Volumes/Data/home/qa-other/work/note.md",
] as const

const isTrigger = (path: unknown): boolean => {
  const text = typeof path === "string" ? path : path instanceof URL ? path.pathname : ""
  if (!text.startsWith("/")) return false
  const under = (path: string, root: string) => path === root || path.startsWith(`${root}/`)
  const lexical = posix.resolve(text).toLowerCase()
  const home = posix.resolve(homedir()).toLowerCase()
  const roots = ["/home", "/net", "/system/volumes/data/home", "/system/volumes/data/net"]
  // Fixture temp dirs are the test's own paths: a host whose TMPDIR sits under /home but outside HOME must not
  // trap them (#11547). A TMPDIR that is itself a trigger root (or `/`) exempts nothing.
  const tmp = posix.resolve(tmpdir()).toLowerCase()
  const fixture = tmp !== "/" && !roots.includes(tmp) && under(lexical, tmp)
  return roots.some((root) => under(lexical, root)) && (home === "/" || !under(lexical, home)) && !fixture
}

type Restorable = { mockRestore(): void }

/**
 * Runs `body` as if on darwin, with every resolving fs entry point (node:fs, node:fs/promises and the memory-core
 * resilient fs) trapped: a call on an automount trigger is recorded and throws, the way a wedged automounter
 * would never answer. Returns the trigger paths that were touched; a guarded site leaves the list empty.
 */
export async function withAutomountTrap(body: () => unknown): Promise<string[]> {
  const touched: string[] = []
  const trap = (name: string, path: unknown): void => {
    if (!isTrigger(path)) return
    touched.push(`${name}(${String(path)})`)
    throw Object.assign(new Error(`AUTOMOUNT_TRAP ${name} ${String(path)}`), { code: "EAUTOMOUNT_TRAP" })
  }
  const spies: Restorable[] = []
  const platform = Object.getOwnPropertyDescriptor(process, "platform")
  const wrapSync = (module: Record<string, unknown>, name: string, label: string): void => {
    const original = module[name]
    if (typeof original !== "function") return
    const native = (original as { native?: (...args: unknown[]) => unknown }).native
    const spy = spyOn(module as Record<string, (...args: unknown[]) => unknown>, name).mockImplementation((path: unknown, ...rest: unknown[]) => {
      trap(`${label}.${name}`, path)
      return (original as (...args: unknown[]) => unknown)(path, ...rest)
    })
    if (native !== undefined) {
      Object.assign(spy, {
        native: (path: unknown, ...rest: unknown[]) => {
          trap(`${label}.${name}.native`, path)
          return native(path, ...rest)
        },
      })
    }
    spies.push(spy)
  }
  try {
    for (const [module, label] of [[nodeFs, "fs"], [memoryFs, "memoryFs"]] as const) {
      for (const name of ["realpathSync", "lstatSync", "statSync", "existsSync", "readFileSync", "realpath"]) wrapSync(module as unknown as Record<string, unknown>, name, label)
    }
    for (const name of ["realpath", "lstat", "stat"]) wrapSync(nodeFsPromises as unknown as Record<string, unknown>, name, "fsp")
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true })
    await body()
  } finally {
    if (platform !== undefined) Object.defineProperty(process, "platform", platform)
    for (const spy of spies.reverse()) spy.mockRestore()
  }
  return touched
}
