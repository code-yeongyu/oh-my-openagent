import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { assembleOmoSdk } from "../assembly"
import { ROOT_DISPOSED } from "./assemble"
import type { ThreadsRuntime } from "./thread-runtime-file"

// Dispose wins with the REAL thread runtime file and core, through the root's own loader (security review 6081319929,
// F1; the LEAD's ruling): with the core's construction held, dispose() begun and the construction then succeeding, the
// racing call answers ROOT_DISPOSED, no member of the built core runs, the core is disposed once, and nothing is written
// under the caller's home. Before the fix list and read reached the host and send wrote a file after core.dispose().

const homes: string[] = []
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

const filesUnder = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort()

const INPUTS = {
  list: {},
  read: { thread: "no-such-thread" },
  send: { thread: "no-such-thread", message: "ping" },
} as const

// Every thread member of the root, with an input that reaches its core call (the sweep below covers all of them).
const SWEEP_INPUTS: Readonly<Record<string, unknown>> = {
  ...INPUTS,
  locate: { thread: "no-such-thread" },
  create: { name: "dispose-sweep" },
  interrupt: { thread: "no-such-thread" },
  close: { thread: "no-such-thread" },
  rename: { thread: "no-such-thread", name: "renamed" },
  setModel: { thread: "no-such-thread", model: "m" },
  release: { thread: "no-such-thread" },
  "extensions.register": {
    name: "probe",
    migrations: [["create table t (id)"]],
    moduleUrl: "file:///probe/extension.js",
    sessionCallable: [],
  },
  "extensions.call": { name: "probe", op: "ping", args: {} },
  "daemon.warm": {},
}

for (const member of Object.keys(INPUTS) as (keyof typeof INPUTS)[])
  test(`#given the real thread runtime file with its core's construction held #when threads.${member} runs, dispose begins and the construction then succeeds #then it answers ROOT_DISPOSED, no core member runs and the home is unchanged`, async () => {
    const home = mkdtempSync(join(tmpdir(), "omo-sdk-dispose-real-core-"))
    homes.push(home)
    let constructing: () => void = () => undefined
    const asked = new Promise<void>((resolve) => {
      constructing = resolve
    })
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const seen = { disposed: 0, called: [] as string[] }
    const loadThreadsRuntime = async (): Promise<ThreadsRuntime> => {
      const file = (await import("#omo-sdk-threads-runtime")) as ThreadsRuntime
      return {
        ...file,
        createThreadCore: (async (...args: Parameters<ThreadsRuntime["createThreadCore"]>) => {
          constructing()
          await gate
          const core = (await file.createThreadCore(...args)) as unknown as Record<string, unknown>
          return new Proxy(core, {
            get(target, key) {
              const value = target[key as string]
              if (typeof value !== "function" || key === "then") return value
              const run = value as (...input: unknown[]) => unknown
              if (key === "dispose")
                return async (...input: unknown[]) => {
                  seen.disposed += 1
                  return run.apply(target, input)
                }
              return (...input: unknown[]) => {
                seen.called.push(String(key))
                return run.apply(target, input)
              }
            },
          })
        }) as unknown as ThreadsRuntime["createThreadCore"],
      }
    }
    const sdk = assembleOmoSdk(
      {
        env: { HOME: home, OMO_SERVICE_API_URL: "https://accounts.example.test" },
        cwd: home,
        agentDir: home,
        principal: { kind: "script", uid: 501 },
        ports: {},
      } as Parameters<typeof assembleOmoSdk>[0],
      { loadThreadsRuntime } as Parameters<typeof assembleOmoSdk>[1],
    ) as unknown as {
      readonly threads: Readonly<Record<keyof typeof INPUTS, (input: unknown) => Promise<unknown>>>
      readonly dispose: () => Promise<void>
    }

    const call = sdk.threads[member](INPUTS[member])
    await asked
    const disposing = sdk.dispose()
    const before = filesUnder(home)
    release()
    const [answer] = await Promise.all([call, disposing])

    expect({ answer, called: seen.called, disposed: seen.disposed, files: filesUnder(home) }).toEqual({
      answer: { kind: "error", error: ROOT_DISPOSED },
      called: [],
      disposed: 1,
      files: before,
    })
  })

// Security read at 15c87d5aa6 (t72y, measured with the real core) and the LEAD's acceptance: with the construction
// released first and dispose() started N turns later, a member reached the core after core.dispose() was called (N = 4
// on the shared path, N = 4..13 for create). For EVERY member and every order (dispose while the construction is held,
// then 0..40 microtask turns, then 1..3 timer turns), the call either answers ROOT_DISPOSED with no core member called,
// or every core member it called ran BEFORE dispose() began (stricter than before core.dispose(), which dispose reaches
// only after its own await); the core is disposed once and nothing is written under
// the home after dispose began. The bound is not today's window: 40 turns is past the longest await path (create's,
// whose input check imports a module) with margin, and the timer turns cover any I/O await.
type Order = "before" | number | `timer${number}`
const ORDERS: readonly Order[] = [
  "before",
  ...Array.from({ length: 41 }, (_, index) => index),
  "timer1",
  "timer2",
  "timer3",
]
// The root path of a sweep member: daemon.warm is the one that is not under threads.
const rootPath = (member: string): string => (member.startsWith("daemon.") ? member : `threads.${member}`)
const memberOf = (root: object, member: string) =>
  rootPath(member)
    .split(".")
    .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], root) as (
    input: unknown,
  ) => Promise<unknown>

// A member that runs to its answer on the real core spends real store work per order, so each test takes five orders.
const ORDER_GROUPS: readonly (readonly Order[])[] = Array.from({ length: Math.ceil(ORDERS.length / 5) }, (_, index) =>
  ORDERS.slice(index * 5, index * 5 + 5),
)
for (const member of Object.keys(SWEEP_INPUTS))
  for (const group of ORDER_GROUPS)
    test(`#given the real thread runtime file #when the construction succeeds and dispose begins at turn ${group.join(", ")} of ${rootPath(member)} #then it answers ROOT_DISPOSED or ran entirely before the dispose`, async () => {
      const violations: string[] = []
      for (const order of group) {
        const home = mkdtempSync(join(tmpdir(), "omo-sdk-dispose-sweep-"))
        homes.push(home)
        let release: () => void = () => undefined
        const gate = new Promise<void>((resolve) => {
          release = resolve
        })
        let constructing: () => void = () => undefined
        const asked = new Promise<void>((resolve) => {
          constructing = resolve
        })
        const seen = { disposeCalled: 0, began: false, called: [] as string[], afterBegan: [] as string[] }
        const loadThreadsRuntime = async (): Promise<ThreadsRuntime> => {
          const file = (await import("#omo-sdk-threads-runtime")) as ThreadsRuntime
          return {
            ...file,
            createThreadCore: (async (...args: Parameters<ThreadsRuntime["createThreadCore"]>) => {
              constructing()
              await gate
              const core = (await file.createThreadCore(...args)) as unknown as Record<string, unknown>
              const watch = (target: Record<string, unknown>, prefix: string): Record<string, unknown> =>
                new Proxy(target, {
                  get(inner, key) {
                    const value = inner[key as string]
                    if (key === "then") return value
                    if (key === "extensions" && typeof value === "object" && value !== null)
                      return watch(value as Record<string, unknown>, "extensions.")
                    if (typeof value !== "function") return value
                    const run = value as (...input: unknown[]) => unknown
                    if (key === "dispose" && prefix === "")
                      return async (...input: unknown[]) => {
                        seen.disposeCalled += 1
                        return run.apply(inner, input)
                      }
                    return (...input: unknown[]) => {
                      seen.called.push(`${prefix}${String(key)}`)
                      if (seen.began) seen.afterBegan.push(`${prefix}${String(key)}`)
                      return run.apply(inner, input)
                    }
                  },
                })
              return watch(core, "")
            }) as unknown as ThreadsRuntime["createThreadCore"],
          }
        }
        const sdk = assembleOmoSdk(
          {
            env: { HOME: home, OMO_SERVICE_API_URL: "https://accounts.example.test" },
            cwd: home,
            agentDir: home,
            principal: { kind: "script", uid: 501 },
            ports: {},
          } as Parameters<typeof assembleOmoSdk>[0],
          { loadThreadsRuntime } as Parameters<typeof assembleOmoSdk>[1],
        ) as unknown as { readonly threads: Readonly<Record<string, unknown>>; readonly dispose: () => Promise<void> }
        const call = memberOf(sdk, member)(SWEEP_INPUTS[member]).catch((error: unknown) => ({ threw: String(error) }))
        // A call the root refuses before the core never asks for it: that is a fixture error here, named, not a hang.
        const reached = await Promise.race([asked.then(() => true), call.then(() => false)])
        if (!reached) {
          violations.push(`${order}: never reached the core: ${JSON.stringify(await call).slice(0, 120)}`)
          release()
          continue
        }
        let disposing: Promise<void>
        let filesAtDispose: string[] = []
        if (order === "before") {
          filesAtDispose = filesUnder(home)
          seen.began = true
          disposing = sdk.dispose()
          release()
        } else {
          release()
          if (typeof order === "number") for (let turn = 0; turn < order; turn += 1) await Promise.resolve()
          else
            for (let turn = 0; turn < Number(order.slice(5)); turn += 1)
              await new Promise<void>((resolve) => setImmediate(resolve))
          filesAtDispose = filesUnder(home)
          seen.began = true
          disposing = sdk.dispose()
        }
        const [answer] = await Promise.all([call, disposing])
        const refused = JSON.stringify(answer) === JSON.stringify({ kind: "error", error: ROOT_DISPOSED })
        if (refused && seen.called.length > 0) violations.push(`${order}: refused but called ${seen.called.join(",")}`)
        if (seen.afterBegan.length > 0) violations.push(`${order}: ${seen.afterBegan.join(",")} after dispose() began`)
        if (seen.disposeCalled !== 1) violations.push(`${order}: core disposed ${seen.disposeCalled} times`)
        const written = filesUnder(home).filter((file) => !filesAtDispose.includes(file))
        if (written.length > 0 && seen.afterBegan.length > 0)
          violations.push(`${order}: wrote ${written.length} files after dispose began`)
      }
      expect(violations).toEqual([])
    })
