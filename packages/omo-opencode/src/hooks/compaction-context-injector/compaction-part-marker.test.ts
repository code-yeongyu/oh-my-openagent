import { describe, expect, test } from "bun:test"
import { clearActiveCompactionPin, setActiveCompactionPin } from "../../shared/compaction-pin-state"
import {
  resolveLatestSessionPromptConfig,
  resolveSessionPromptConfig,
} from "./session-prompt-config-resolver"

// fix: compaction-part-marker — a marker row tagged with the WORKING agent but
// carrying a compaction PART is bookkeeping, never working-model evidence.
// Agent-name checks alone miss it (observed 2026-09-27T23:37Z: the marker's
// glm-5.3-flash became "current prompt config" and vetoed the kimi checkpoint).

const fakeCtx = (messages: Array<Record<string, unknown>>) => ({
  client: { session: { messages: async () => ({ data: messages }) } },
  directory: "test",
})

describe("compaction-part marker exclusion (compaction-part-marker)", () => {
  test("resolveSessionPromptConfig skips a working-agent marker that carries a compaction part", async () => {
    const ctx = fakeCtx([
      { info: { agent: "Sisyphus - ultraworker", model: { providerID: "kimi-for-coding", modelID: "k3-256k", variant: "high" } }, parts: [{ type: "text", text: "hi" }] },
      { info: { agent: "Sisyphus - ultraworker", model: { providerID: "zai-coding-plan", modelID: "glm-5.3-flash" } }, parts: [{ type: "compaction" }] },
      { info: { agent: "compaction", model: { providerID: "zai-coding-plan", modelID: "glm-5.3-flash" } }, parts: [{ type: "step-start" }] },
    ])
    const config = await resolveSessionPromptConfig(ctx as never, "ses_pm1")
    expect(config.model).toEqual({ providerID: "kimi-for-coding", modelID: "k3-256k", variant: "high" })
  })

  test("resolveSessionPromptConfig skips the same marker even after the pin state was released", async () => {
    setActiveCompactionPin("ses_pm2", { providerID: "zai-coding-plan", modelID: "glm-5.3-flash" })
    clearActiveCompactionPin("ses_pm2")
    const ctx = fakeCtx([
      { info: { agent: "Sisyphus - ultraworker", model: { providerID: "kimi-for-coding", modelID: "k3-256k" } }, parts: [{ type: "text" }] },
      { info: { agent: "Sisyphus - ultraworker", model: { providerID: "zai-coding-plan", modelID: "glm-5.3-flash" } }, parts: [{ type: "compaction" }] },
    ])
    const config = await resolveSessionPromptConfig(ctx as never, "ses_pm2")
    expect(config.model).toEqual({ providerID: "kimi-for-coding", modelID: "k3-256k" })
  })

  test("resolveLatestSessionPromptConfig omits the model of a compaction-part marker", async () => {
    const ctx = fakeCtx([
      { info: { agent: "Sisyphus - ultraworker", model: { providerID: "kimi-for-coding", modelID: "k3-256k" } }, parts: [{ type: "text" }] },
      { info: { agent: "Sisyphus - ultraworker", model: { providerID: "zai-coding-plan", modelID: "glm-5.3-flash" } }, parts: [{ type: "compaction" }] },
    ])
    const config = await resolveLatestSessionPromptConfig(ctx as never, "ses_pm3")
    expect(config.model).toBeUndefined()
  })
})
