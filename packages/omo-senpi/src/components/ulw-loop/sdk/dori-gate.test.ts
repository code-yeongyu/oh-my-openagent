import { expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { DORI_TOOLKIT_ENV, DORI_TOOLKIT_NAMESPACES, applyDoriToolkitGate, doriLayer2Path, isDoriSectionEnabled } from "./dori-gate"

const here = dirname(fileURLToPath(import.meta.url))
const sdkEntry = resolve(here, "../../../extension/agent-toolkit-sdk.ts")
const threadComponent = resolve(here, "../../thread/component.ts")

test("#given the dori section #when the gate reads it #then only a present object not switched off enables the toolkit", () => {
  for (const off of [undefined, null, [], "on", true, { enabled: false }]) expect(isDoriSectionEnabled(off)).toBe(false)
  for (const on of [{}, { enabled: true }, { scopes: ["x"] }]) expect(isDoriSectionEnabled(on)).toBe(true)
})

test("#given the gate decision #when it is applied #then the kernel env flag is set on and removed off", () => {
  const env: NodeJS.ProcessEnv = { [DORI_TOOLKIT_ENV]: "1" }
  expect(applyDoriToolkitGate({ enabled: false }, env)).toBe(false)
  expect(env[DORI_TOOLKIT_ENV]).toBeUndefined()
  expect(applyDoriToolkitGate({}, env)).toBe(true)
  expect(env[DORI_TOOLKIT_ENV]).toBe("1")
})

test("#given declared tool names #when mapped to layer-2 paths #then only the dori extension's namespace tools map", () => {
  expect(doriLayer2Path("dori", "reply_mark")).toEqual({ namespace: "reply", op: "reply.mark" })
  expect(doriLayer2Path("dori", "send_typing_stop")).toEqual({ namespace: "send", op: "send.typing.stop" })
  expect(doriLayer2Path("dori", "bogus_mark")).toBeUndefined()
  expect(doriLayer2Path("dori", "reply")).toBeUndefined()
  expect(doriLayer2Path("other", "reply_mark")).toBeUndefined()
  expect([...DORI_TOOLKIT_NAMESPACES]).toEqual(["route", "reply", "room", "send", "thread", "describe", "file", "rules", "iam", "call", "work"])
})

function resolveRelative(from: string, specifier: string): string | undefined {
  const base = resolve(dirname(from), specifier)
  const candidates = [base, `${base}.ts`, `${base}.mjs`, join(base, "index.ts"), base.replace(/\.js$/, ".ts")]
  return candidates.find((candidate) => existsSync(candidate) && !candidate.endsWith("/"))
}

function moduleGraph(entry: string): { readonly statics: ReadonlySet<string>; readonly dynamics: ReadonlySet<string> } {
  const transpiler = new Bun.Transpiler({ loader: "ts" })
  const statics = new Set<string>()
  const dynamics = new Set<string>()
  const pending = [entry]
  while (pending.length > 0) {
    const file = pending.pop() as string
    if (statics.has(file)) continue
    statics.add(file)
    if (!/\.(ts|mjs|js)$/.test(file) || file.includes("/node_modules/")) continue
    for (const edge of transpiler.scanImports(readFileSync(file, "utf8"))) {
      if (!edge.path.startsWith(".")) continue
      const target = resolveRelative(file, edge.path)
      if (target === undefined) continue
      if (edge.kind === "dynamic-import") dynamics.add(target)
      else pending.push(target)
    }
  }
  return { statics, dynamics }
}

test("#given the agent toolkit SDK and the thread component #when their import-time module graphs are walked #then no dori layer module loads statically and the layer is reachable only by a dynamic import", () => {
  const layer = resolve(here, "dori/layer2.ts")
  const replay = resolve(here, "../../thread/tools/dori-replay.ts")
  const sdk = moduleGraph(sdkEntry)
  const thread = moduleGraph(threadComponent)
  for (const graph of [sdk, thread]) {
    expect([...graph.statics].filter((file) => file.includes("/sdk/dori/") || file.endsWith("/dori-replay.ts"))).toEqual([])
  }
  expect([...sdk.statics].filter((file) => file.endsWith("/dori-gate.ts"))).toEqual([])
  expect(sdk.dynamics.has(layer)).toBe(true)
  expect(thread.dynamics.has(replay)).toBe(true)
})

async function toolkitKeys(env: Record<string, string | undefined>): Promise<string[]> {
  const child = Bun.spawn([process.execPath, "-e", `const { agentToolkit } = await import(${JSON.stringify(sdkEntry)}); console.log(JSON.stringify(Object.keys(agentToolkit)))`], {
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (code !== 0) throw new Error(`toolkit import exited ${code}: ${stderr}`)
  return JSON.parse(stdout.trim()) as string[]
}

test("#given the kernel env flag #when the SDK is imported #then the namespaces exist only with the flag on", async () => {
  const off = await toolkitKeys({ [DORI_TOOLKIT_ENV]: undefined })
  const on = await toolkitKeys({ [DORI_TOOLKIT_ENV]: "1" })
  for (const namespace of DORI_TOOLKIT_NAMESPACES) {
    expect(off).not.toContain(namespace)
    expect(on).toContain(namespace)
  }
  expect(on.filter((key) => !DORI_TOOLKIT_NAMESPACES.some((namespace) => namespace === key))).toEqual(off)
}, 30_000)
