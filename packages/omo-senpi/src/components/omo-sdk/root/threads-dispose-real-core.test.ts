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
