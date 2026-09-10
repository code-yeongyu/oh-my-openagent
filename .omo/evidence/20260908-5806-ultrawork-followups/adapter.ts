import { createHash } from "node:crypto"
import { appendFileSync, renameSync, writeFileSync } from "node:fs"
import { createKeywordDetectorHook } from "../../../packages/omo-opencode/src/hooks/keyword-detector/hook"
import { resolveUltraworkOverride } from "../../../packages/omo-opencode/src/plugin/ultrawork-model-override"
import { stopContinuation } from "../../../packages/omo-opencode/src/plugin/stop-continuation"
import { createEventHookDispatcher, createEventHookRunner } from "../../../packages/omo-opencode/src/plugin/event-hook-dispatcher"
import { createPluginInterface } from "../../../packages/omo-opencode/src/plugin-interface"
import { createCompactionAutocontinueHandler } from "../../../packages/omo-opencode/src/plugin/session-compacting"
import { resolveSessionEventID } from "../../../packages/omo-opencode/src/shared/event-session-id"
import { isRealUserTextPart } from "../../../packages/omo-opencode/src/shared"
import { unsafeTestValue } from "../../../test-support/unsafe-test-value"
import type { PluginInput } from "@opencode-ai/plugin"

export default {
  id: "qa-ulw-followup",
  async server(ctx: PluginInput) {
    writeFileSync("/qa/factory.json", JSON.stringify({ directory: ctx.directory }))
    const hook = createKeywordDetectorHook(ctx)
    const pluginInterface = createPluginInterface(unsafeTestValue<Parameters<typeof createPluginInterface>[0]>({
      ctx,
      pluginConfig: {},
      firstMessageVariantGate: {
        shouldOverride: () => false,
        markApplied: () => {},
        markSessionCreated: () => {},
        clear: () => {},
      },
      managers: {},
      hooks: { keywordDetector: hook },
      tools: {},
    }))
    const autocontinue = createCompactionAutocontinueHandler({})
    const routedEvents = new Set<string>()
    const safe = createEventHookRunner()
    const dispatch = createEventHookDispatcher(
      unsafeTestValue<Parameters<typeof createEventHookDispatcher>[0]>({ keywordDetector: hook }),
      async (name, handler, input) => {
        if (name === "keywordDetector" && handler) routedEvents.add(input.event.type)
        await safe(name, handler, input)
      },
    )
    return {
      ...hook,
      "experimental.chat.system.transform": async (input, output) => {
        await pluginInterface["experimental.chat.system.transform"]?.(input, output)
        const guidance = output.system.find((part) => part.includes("<ultrawork-mode>"))
        if (!guidance) return
        writeFileSync("/qa/system-guidance.txt", guidance)
        writeFileSync("/qa/system-guidance.json.tmp", JSON.stringify({
          bytes: Buffer.byteLength(guidance),
          sha256: createHash("sha256").update(guidance).digest("hex"),
        }))
        renameSync("/qa/system-guidance.json.tmp", "/qa/system-guidance.json")
      },
      "experimental.compaction.autocontinue": async (input, output) => {
        await autocontinue(input, output)
        writeFileSync("/qa/autocontinue.json.tmp", JSON.stringify({ enabled: output.enabled }))
        renameSync("/qa/autocontinue.json.tmp", "/qa/autocontinue.json")
      },
      event: async (input: Parameters<typeof dispatch>[0]) => {
        await dispatch(input)
        if (input.event.type === "session.compacted") {
          writeFileSync("/qa/compacted.json.tmp", JSON.stringify({ routed: routedEvents.has("session.compacted") }))
          renameSync("/qa/compacted.json.tmp", "/qa/compacted.json")
        }
        if (input.event.type === "session.deleted") {
          const sessionID = resolveSessionEventID(input.event.properties)
          if (!sessionID) throw new Error("Missing deleted session id")
          const probe = { message: {}, parts: [{ type: "text", text: "ordinary request" }] }
          await hook["chat.message"]({ sessionID, agent: "sisyphus" }, probe)
          const receipt = { routed: routedEvents.has("session.deleted"), cleared: !probe.parts.some(part => part.text.includes("<ultrawork-mode>")) }
          writeFileSync("/qa/deletion.json.tmp", JSON.stringify(receipt))
          renameSync("/qa/deletion.json.tmp", "/qa/deletion.json")
        }
      },
      "command.execute.before": async (input: { command: string; sessionID: string }) => {
        if (input.command === "stop-continuation") {
          stopContinuation({ directory: ctx.directory, hooks: { keywordDetector: hook }, sessionID: input.sessionID })
        }
      },
      "chat.message": async (
        input: Parameters<typeof hook["chat.message"]>[0],
        output: Parameters<typeof hook["chat.message"]>[1],
      ) => {
        const originalText = output.parts.find(isRealUserTextPart)?.text
        const originalCount = output.parts.length
        await hook["chat.message"](input, output)
        if (originalText === undefined) return
        const active = output.parts.some(part => part.text?.includes("<ultrawork-mode>"))
        const compact = output.parts.some(part => part.synthetic === true && part.text === "<ultrawork-mode>active</ultrawork-mode>")
        const override = resolveUltraworkOverride({
          agents: { sisyphus: { ultrawork: { model: "qa/ulw-selected" } } },
        }, input.agent, output, input.sessionID)
        appendFileSync("/qa/calls.jsonl", JSON.stringify({
          active, override, kind: compact ? "marker" : active ? "full" : "none",
          originalTextPreserved: output.parts.find(isRealUserTextPart)?.text === originalText,
          addedParts: output.parts.length - originalCount,
        }) + "\n")
      },
    }
  },
}
