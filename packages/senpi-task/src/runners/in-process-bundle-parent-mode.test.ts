import { afterEach, describe, expect, test } from "bun:test"

import type { ChildDialogForwarder } from "./child-dialogs/forwarder"
import { InProcessRunner } from "./in-process"
import { createGatedChildMachine, type GatedChildMachine } from "./in-process/__fixtures__/gated-child"

// #12965: omo's launcher boots the parent from senpi's pre-linked bundle (`dist/bundle/cli.js`), while an in-process
// task child is created through the SDK barrel (`dist/index.js`). The parent session therefore lives in the bundle's
// module graph, and the child must still find it as its live parent and follow its mode instead of asking.
// The parent here is opened through `dist/bundle/index.js`, which reaches the same bundle chunks the bundled CLI does.

type SenpiModule = typeof import("@code-yeongyu/senpi")

const machines: GatedChildMachine[] = []
const disposers: (() => void)[] = []
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  for (const machine of machines.splice(0)) machine.cleanup()
})

async function loadBundledSenpi(): Promise<SenpiModule> {
  const sdkEntry = import.meta.resolve("@code-yeongyu/senpi")
  return (await import(new URL("./bundle/index.js", sdkEntry).href)) as SenpiModule
}

async function openBundledParent(cwd: string, agentDir: string): Promise<string> {
  const bundled = await loadBundledSenpi()
  const modelRuntime = bundled.ModelRuntime.createSync({ agentDir, allowModelNetwork: false, refreshOnCreate: false })
  const modelRegistry = new bundled.ModelRegistry(modelRuntime)
  const { session } = await bundled.createAgentSession({ cwd, agentDir, sessionManager: bundled.SessionManager.inMemory(cwd), modelRuntime, modelRegistry })
  disposers.push(() => session.dispose())
  return session.sessionManager.getSessionId()
}

describe("InProcessRunner under a parent from the bundled engine", () => {
  test("#given a host-default parent opened through the bundled engine #when its in-process child makes a gated call #then the child follows the parent and does not ask", async () => {
    // given
    const machine = await createGatedChildMachine({})
    machines.push(machine)
    const { cwd, agentDir } = machine.spec("st_12965")
    if (agentDir === undefined) throw new Error("the gated child machine has no agent dir")
    const parentSessionId = await openBundledParent(cwd, agentDir)
    const seen: string[] = []
    const forwarder: ChildDialogForwarder = { forward: async (dialog) => { seen.push(dialog.method); return { kind: "value", value: "Deny" } } }

    // when
    const handle = await new InProcessRunner({ dialogs: forwarder }).start(machine.spec("st_12965", parentSessionId))
    await handle.waitForIdle()
    await handle.abort()

    // then
    expect(seen).toEqual([])
    expect(machine.probeExists()).toBe(true)
  }, 30_000)
})
