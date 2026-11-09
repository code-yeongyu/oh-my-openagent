import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadSenpiBarrel } from "../../../lazy/senpi-barrel"
import { assistant, streamMessage } from "../../__fixtures__/in-process-fallback-session"
import type { ChildSpec } from "../../in-process"

// #6189 F2d: an in-process child whose engine settings say `ask` and whose fake provider makes exactly one gated
// call, `write <probe>`, then ends its turn. Only the provider's replies are faked; the permission system,
// the bash tool and the session are the real engine's.

const PROVIDER = "gated-child-test"
const MODEL = "gated"

export type GatedChildMachine = {
  readonly probe: string
  spec(taskId: string, parentSessionId?: string): ChildSpec
  // A live parent session in this process, on the host default (no client-named mode); `dispose` releases it.
  openParent(): Promise<{ readonly sessionId: string; dispose(): void }>
  probeExists(): boolean
  cleanup(): void
}

export async function createGatedChildMachine(options: { readonly settingsPreset?: string } = { settingsPreset: "ask" }): Promise<GatedChildMachine> {
  const senpi = await loadSenpiBarrel()
  const root = mkdtempSync(join(tmpdir(), "senpi-task-6189-"))
  const agentDir = join(root, "agent")
  const cwd = join(root, "work")
  mkdirSync(agentDir, { recursive: true })
  mkdirSync(cwd, { recursive: true })
  if (options.settingsPreset !== undefined) writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ permissionPreset: options.settingsPreset }))
  const probe = join(cwd, "probe.txt")
  const modelRuntime = senpi.ModelRuntime.createSync({ agentDir, allowModelNetwork: false, refreshOnCreate: false })
  const modelRegistry = new senpi.ModelRegistry(modelRuntime)
  let calls = 0
  const provider = {
    api: "openai-completions",
    baseUrl: "file://gated-child-test",
    apiKey: "test-key",
    models: [{ id: MODEL, name: MODEL, reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200_000, maxTokens: 4096 }],
    streamSimple() {
      calls += 1
      if (calls > 1) return streamMessage(assistant(MODEL, "stop", "done", undefined, PROVIDER))
      const toolUse = assistant(MODEL, "toolUse", "", undefined, PROVIDER)
      return streamMessage({ ...toolUse, content: [{ type: "toolCall", id: "call-probe", name: "write", arguments: { path: probe, content: "probe" } }] })
    },
  }
  Reflect.apply(modelRegistry.registerProvider, modelRegistry, [PROVIDER, provider])
  const model = modelRegistry.find(PROVIDER, MODEL)
  if (model === undefined) throw new Error("the gated model is missing from the fake provider")
  return {
    probe,
    openParent: async () => {
      const { session } = await senpi.createAgentSession({ cwd, agentDir, sessionManager: senpi.SessionManager.inMemory(cwd), modelRuntime, modelRegistry, model })
      return { sessionId: session.sessionManager.getSessionId(), dispose: () => session.dispose() }
    },
    spec: (taskId, parentSessionId = "parent-6189") => ({
      taskId,
      cwd,
      sessionDir: join(root, "children", taskId),
      agentDir,
      projectTrusted: false,
      modelRuntime,
      modelRegistry,
      model,
      selectedModel: `${PROVIDER}/${MODEL}`,
      retry: { maxRetries: 0 },
      depth: 1,
      parentSessionId,
      rootSessionId: parentSessionId,
      prompt: "touch the probe",
      promptEnvelope: "bare",
      completion: "turn",
    }),
    probeExists: () => existsSync(probe),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}
