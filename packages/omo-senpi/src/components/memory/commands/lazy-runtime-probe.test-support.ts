// Fresh-process probe for the lazy memory commands sidecar (`#omo-memory-commands-runtime`).
//
// `bun test` shares one module registry across every test file, so "first use" can only be observed
// in a process that has never imported the sidecar. lazy-runtime.test.ts spawns this script; a Bun
// runtime plugin counts every evaluation of the sidecar entry, and the probe prints one JSON line.

import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const RUNTIME_ENTRY = /[\\/]memory[\\/]commands[\\/]runtime\.ts$/
const runtimeLoads: string[] = []

Bun.plugin({
  name: "memory-commands-runtime-load-counter",
  setup(build) {
    build.onLoad({ filter: RUNTIME_ENTRY }, (args) => {
      runtimeLoads.push(args.path)
      return { contents: readFileSync(args.path, "utf8"), loader: "ts" }
    })
  },
})

const { removeTree } = await import("../../../../../../test-support/remove-tree")
const { MemoryFakeExtensionAPI } = await import("../memory.test-support")
const { fakeCommandContext, fakeDeps, invoke, seededRepo, tempIdentity } = await import("./commands.test-support")
const { registerMemoryCommands } = await import("./register")
const { registerMemoryCommand } = await import("./memory")
const { registerSleeptimeCommand } = await import("./sleeptime")

const { root, identity } = await tempIdentity(mkdtempSync(join(tmpdir(), "memory-commands-lazy-probe-")))
try {
  await seededRepo(identity, [{ relativePath: "system/persona.md", content: "---\ndescription: Persona\n---\nlazy probe\n" }])
  const deps = fakeDeps(identity)

  const lazyPi = new MemoryFakeExtensionAPI()
  registerMemoryCommands(lazyPi, deps)
  const loadsAfterRegistration = runtimeLoads.length

  const lazyMemoryCtx = fakeCommandContext()
  const lazyMemory = await invoke(lazyPi, "memory", "", lazyMemoryCtx)
  const loadsAfterFirstUse = runtimeLoads.length
  const lazySleeptimeCtx = fakeCommandContext()
  const lazySleeptime = await invoke(lazyPi, "sleeptime", "", lazySleeptimeCtx)

  const eagerPi = new MemoryFakeExtensionAPI()
  registerMemoryCommand(eagerPi, deps)
  registerSleeptimeCommand(eagerPi, deps)
  const eagerMemoryCtx = fakeCommandContext()
  const eagerMemory = await invoke(eagerPi, "memory", "", eagerMemoryCtx)
  const eagerSleeptimeCtx = fakeCommandContext()
  const eagerSleeptime = await invoke(eagerPi, "sleeptime", "", eagerSleeptimeCtx)

  const metadata = (pi: InstanceType<typeof MemoryFakeExtensionAPI>, name: string) => {
    const options = pi.commands.find((command) => command.name === name)?.options
    return { description: options?.description, argumentHint: options?.argumentHint }
  }

  console.log(`PROBE_RESULT ${JSON.stringify({
    loadsAfterRegistration,
    loadsAfterFirstUse,
    loadsTotal: runtimeLoads.length,
    lazy: [
      { result: lazyMemory, notifications: lazyMemoryCtx.ui.notifications },
      { result: lazySleeptime, notifications: lazySleeptimeCtx.ui.notifications },
    ],
    eager: [
      { result: eagerMemory, notifications: eagerMemoryCtx.ui.notifications },
      { result: eagerSleeptime, notifications: eagerSleeptimeCtx.ui.notifications },
    ],
    lazyMetadata: [metadata(lazyPi, "memory"), metadata(lazyPi, "sleeptime")],
    eagerMetadata: [metadata(eagerPi, "memory"), metadata(eagerPi, "sleeptime")],
  })}`)
} finally {
  await removeTree(root, { maxRetries: 10, retryDelay: 200 })
}
