/// <reference types="bun-types" />

import { afterEach, describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

// #12965: inside an engine process the plugin must run on the engine that loaded it (`pi.engine`), never on a
// second copy its own import of the engine index would evaluate on Node. Every extension factory that ships the
// senpi barrel seeds it first, and the sites that used to import the index read the barrel. Each case runs in a
// fresh Bun process whose loader makes any evaluation of the engine index throw, because the barrel state is
// process-wide.

const fileUrl = (relative: string): string => pathToFileURL(fileURLToPath(new URL(relative, import.meta.url))).href
const MODULES = {
  barrel: fileUrl("../../../senpi-task/src/lazy/senpi-barrel.ts"),
  compose: fileUrl("./compose.ts"),
  member: fileUrl("../../../senpi-task/src/team/member-extension/index.ts"),
  toolkit: fileUrl("../components/desktop-toolkit/runtime.ts"),
  task: fileUrl("../components/task/index.ts"),
  facts: fileUrl("../components/memory/facts-oversized-child.ts"),
  widgets: fileUrl("../components/task/job-widget-host.ts"),
  hostTool: fileUrl("../components/desktop-toolkit/host-tool-execution.ts"),
} as const
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Runs `body` (which reads `modules` and `barrel`, and assigns `result`) where the engine index cannot be evaluated. */
function runWithoutEngineIndex(body: string): Record<string, unknown> {
  const root = mkdtempSync(join(tmpdir(), "engine-barrel-seeding-"))
  roots.push(root)
  const script = join(root, "run.ts")
  writeFileSync(
    script,
    `Bun.plugin({
  setup(build) {
    build.onLoad({ filter: /@code-yeongyu[\\\\/]senpi[\\\\/]dist[\\\\/]index\\.js$/ }, () => ({ contents: 'throw new Error("the engine index was evaluated")', loader: "js" }))
  },
})
const modules = ${JSON.stringify(MODULES)}
const barrel = await import(modules.barrel)
const engineOf = (name) => ({ createAgentSession: () => name })
let result
${body}
console.log(JSON.stringify(result))
`,
  )
  const child = spawnSync(process.execPath, [script], { encoding: "utf8", timeout: 60_000 })
  if (child.status !== 0) throw new Error(`script exited ${String(child.status)}: ${child.stderr}`)
  const lines = child.stdout.trim().split("\n")
  return JSON.parse(lines[lines.length - 1] ?? "null") as Record<string, unknown>
}

describe("the senpi barrel inside an engine process", () => {
  it("#given an extension API that carries the engine #when each factory that ships the barrel runs #then the barrel is that factory's engine", () => {
    // when
    const out = runWithoutEngineIndex(`const { composeOmoSenpiExtension } = await import(modules.compose)
const member = await import(modules.member)
const { createDesktopToolkitRuntime } = await import(modules.toolkit)
const { createTaskComponent } = await import(modules.task)
const quiet = { debug() {}, info() {}, warn() {}, error() {} }
const engines = { entry: engineOf("entry"), member: engineOf("member"), toolkit: engineOf("toolkit"), task: engineOf("task") }
const seeded = (engine) => barrel.senpiBarrel() === engine
result = {}
await composeOmoSenpiExtension([], { logger: quiet })({ engine: engines.entry })
result.entry = seeded(engines.entry)
await member.default({ engine: engines.member })
result.member = seeded(engines.member)
createDesktopToolkitRuntime().register({ engine: engines.toolkit }, { logger: quiet })
result.toolkit = seeded(engines.toolkit)
await createTaskComponent().register({ engine: engines.task, sessionContext: { role: "dag_child" } }, { logger: quiet })
result.task = seeded(engines.task)`)

    // then
    expect(out).toEqual({ entry: true, member: true, toolkit: true, task: true })
  }, 90_000)

  it("#given a seeded barrel #when the facts child, the job widget host and the host tool reach for the engine #then each uses the seeded engine", () => {
    // when
    const out = runWithoutEngineIndex(`const child = { agent: { streamFunction() {} }, abortCompaction() {}, setAutoCompactionEnabled() {}, subscribe: () => () => {}, dispose() {}, abort: async () => {} }
barrel.seedSenpiBarrel({
  createAgentSession: async () => ({ session: child }),
  registerJobWidgetSource: (registration) => ({ registered: registration.id }),
  TextTap: class {},
  writeHtmlPage: async (args, cwd) => ({ page: args.title, cwd }),
})
const { createOversizedFactsGuard } = await import(modules.facts)
const { loadJobWidgetHost } = await import(modules.widgets)
const { registerHostToolExecution } = await import(modules.hostTool)
const guard = createOversizedFactsGuard({ model: { provider: "p", id: "m", contextWindow: 1, maxTokens: 1 }, onFailure() {} })
const host = await loadJobWidgetHost()
let execute
registerHostToolExecution({ cwd: "/work", rpc: { handle: (_name, handler) => { execute = handler } } }, new Set(["show_html_page"]))
result = {
  factsChildIsSeeded: (await guard.createSession({})) === child,
  widgetSource: host.sources?.register({ id: "w1" }),
  hostTool: await execute({ name: "show_html_page", args: { html: "<p>x</p>", title: "t" } }, { admit: (run) => run() }),
}`)

    // then
    expect(out).toEqual({ factsChildIsSeeded: true, widgetSource: { registered: "w1" }, hostTool: { page: "t", cwd: "/work" } })
  }, 90_000)
})
