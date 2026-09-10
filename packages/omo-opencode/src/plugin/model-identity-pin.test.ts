import { afterEach, describe, expect, test } from "bun:test"

import {
  clearSisyphusRuntimePromptContext,
  reconcileSisyphusRuntimePrompt,
  setSisyphusRuntimePromptContext,
} from "../agents/sisyphus-runtime-prompt-reconciler"
import { getUltraworkMessage, getUltraworkSource } from "../hooks/keyword-detector/ultrawork"
import { createSystemTransformHandler } from "./system-transform"
import {
  clearModelIdentityPinCaches,
  pinnedRebuildPrompt,
  pinnedUltraworkMessage,
  readVariantID,
  toModelIdentityKey,
  toRebuildIdentityKey,
  type ModelIdentity,
} from "./model-identity-pin"

const SESSION = "ses-pin-byte-stable"
const GPT_MODEL = "openai/gpt-5.5"
const GEMINI_MODEL = "google/gemini-3.1-pro"

function ultraworkIdentity(modelID: string, variantID = ""): ModelIdentity {
  return { sessionID: SESSION, agentName: "sisyphus", modelID, variantID }
}

afterEach(() => {
  clearModelIdentityPinCaches()
  clearSisyphusRuntimePromptContext()
})

describe("model identity pin key", () => {
  test("#given the same four inputs twice #then the key is identical", () => {
    expect(toModelIdentityKey(ultraworkIdentity(GPT_MODEL, "high"))).toBe(
      toModelIdentityKey(ultraworkIdentity(GPT_MODEL, "high")),
    )
  })

  test("#given a different variantID #then the key differs", () => {
    expect(toModelIdentityKey(ultraworkIdentity(GPT_MODEL, "high"))).not.toBe(
      toModelIdentityKey(ultraworkIdentity(GPT_MODEL, "low")),
    )
  })

  test("#given an omitted variantID #then the key matches an empty variantID", () => {
    const omitted: ModelIdentity = { sessionID: SESSION, agentName: "sisyphus", modelID: GPT_MODEL }
    expect(toModelIdentityKey(omitted)).toBe(toModelIdentityKey(ultraworkIdentity(GPT_MODEL, "")))
  })

  test("#given a non-string variant field #then readVariantID falls back to empty", () => {
    expect(readVariantID({ variant: 7 })).toBe("")
    expect(readVariantID(undefined)).toBe("")
    expect(readVariantID({ variant: "high" })).toBe("high")
  })
})

describe("pinned ultrawork selection", () => {
  test("#given the same identity twice #then bytes are identical and compute runs once", () => {
    let calls = 0
    const compute = (): string => {
      calls += 1
      return getUltraworkMessage("sisyphus", GPT_MODEL)
    }

    const first = pinnedUltraworkMessage(ultraworkIdentity(GPT_MODEL), compute)
    const second = pinnedUltraworkMessage(ultraworkIdentity(GPT_MODEL), compute)

    expect(second).toBe(first)
    expect(calls).toBe(1)
  })

  test("#given a model switch #then the pinned bytes change deterministically", () => {
    const gptFirst = pinnedUltraworkMessage(ultraworkIdentity(GPT_MODEL), () =>
      getUltraworkMessage("sisyphus", GPT_MODEL),
    )
    const geminiFirst = pinnedUltraworkMessage(ultraworkIdentity(GEMINI_MODEL), () =>
      getUltraworkMessage("sisyphus", GEMINI_MODEL),
    )
    const gptSecond = pinnedUltraworkMessage(ultraworkIdentity(GPT_MODEL), () =>
      getUltraworkMessage("sisyphus", GPT_MODEL),
    )
    const geminiSecond = pinnedUltraworkMessage(ultraworkIdentity(GEMINI_MODEL), () =>
      getUltraworkMessage("sisyphus", GEMINI_MODEL),
    )

    expect(geminiFirst).not.toBe(gptFirst)
    expect(gptSecond).toBe(gptFirst)
    expect(geminiSecond).toBe(geminiFirst)
    expect(getUltraworkSource("sisyphus", GPT_MODEL)).toBe("gpt")
    expect(getUltraworkSource("sisyphus", GEMINI_MODEL)).toBe("gemini")
  })

  test("#given the same model with different variants #then each variant pins separately", () => {
    let calls = 0
    const compute = (): string => {
      calls += 1
      return getUltraworkMessage("sisyphus", GPT_MODEL)
    }

    const high = pinnedUltraworkMessage(ultraworkIdentity(GPT_MODEL, "high"), compute)
    const low = pinnedUltraworkMessage(ultraworkIdentity(GPT_MODEL, "low"), compute)
    const highAgain = pinnedUltraworkMessage(ultraworkIdentity(GPT_MODEL, "high"), compute)

    expect(highAgain).toBe(high)
    expect(low).toBe(high)
    expect(calls).toBe(2)
  })
})

describe("pinned sisyphus rebuild", () => {
  test("#given the same rebuild identity twice #then bytes are identical and rebuild runs once", () => {
    let calls = 0
    const identity = {
      sessionID: SESSION,
      configuredModel: GPT_MODEL,
      runtimeModel: GEMINI_MODEL,
      variantID: "",
    }

    const first = pinnedRebuildPrompt(identity, (model) => {
      calls += 1
      return `rebuilt-for-${model}`
    })
    const second = pinnedRebuildPrompt(identity, (model) => {
      calls += 1
      return `rebuilt-for-${model}`
    })

    expect(second).toBe(first)
    expect(first).toBe("rebuilt-for-google/gemini-3.1-pro")
    expect(calls).toBe(1)
    expect(toRebuildIdentityKey(identity)).toBe(toRebuildIdentityKey({ ...identity }))
  })

  test("#given a runtime model switch #then the pinned rebuild changes deterministically", () => {
    const forGemini = pinnedRebuildPrompt(
      { sessionID: SESSION, configuredModel: GPT_MODEL, runtimeModel: GEMINI_MODEL },
      (model) => `rebuilt-for-${model}`,
    )
    const forGpt = pinnedRebuildPrompt(
      { sessionID: SESSION, configuredModel: GPT_MODEL, runtimeModel: GPT_MODEL },
      (model) => `rebuilt-for-${model}`,
    )

    expect(forGpt).not.toBe(forGemini)
    expect(
      pinnedRebuildPrompt(
        { sessionID: SESSION, configuredModel: GPT_MODEL, runtimeModel: GEMINI_MODEL },
        (model) => `rebuilt-for-${model}`,
      ),
    ).toBe(forGemini)
  })
})

describe("pinned sisyphus reconciliation", () => {
  test("#given rebuilt equals baked #then reconcile is a noop with byte-identical output", () => {
    const baked = "pinned baked body"
    setSisyphusRuntimePromptContext({
      configuredModel: GPT_MODEL,
      bakedPrompt: baked,
      rebuildPromptForModel: () => baked,
    })

    const first = [baked]
    expect(
      reconcileSisyphusRuntimePrompt(first, GEMINI_MODEL, { sessionID: SESSION }),
    ).toBe(false)
    const second = [baked]
    expect(
      reconcileSisyphusRuntimePrompt(second, GEMINI_MODEL, { sessionID: SESSION }),
    ).toBe(false)

    expect(first[0]).toBe(baked)
    expect(second[0]).toBe(first[0])
  })

  test("#given a model switch with a distinct rebuild #then the swap output is byte-identical across repeats", () => {
    const baked = "pinned baked body"
    const rebuilt = "pinned rebuilt body"
    let calls = 0
    setSisyphusRuntimePromptContext({
      configuredModel: GPT_MODEL,
      bakedPrompt: baked,
      rebuildPromptForModel: (model) => {
        calls += 1
        return model === GPT_MODEL ? baked : rebuilt
      },
    })

    const first = [baked]
    expect(
      reconcileSisyphusRuntimePrompt(first, GEMINI_MODEL, { sessionID: SESSION }),
    ).toBe(true)
    const second = [baked]
    expect(
      reconcileSisyphusRuntimePrompt(second, GEMINI_MODEL, { sessionID: SESSION }),
    ).toBe(true)

    expect(first[0]).toBe(rebuilt)
    expect(second[0]).toBe(first[0])
    expect(calls).toBe(1)
  })
})

describe("pinned system-transform handler", () => {
  test("#given the same session and model twice #then the system output is byte-identical", async () => {
    const handler = createSystemTransformHandler({ ultrawork: true }, getUltraworkMessage)

    const first = { system: ["base system prompt"] }
    await handler(
      { sessionID: SESSION, model: { id: "gpt-5.5", providerID: "openai" } },
      first,
    )
    const second = { system: ["base system prompt"] }
    await handler(
      { sessionID: SESSION, model: { id: "gpt-5.5", providerID: "openai" } },
      second,
    )

    expect(second.system).toEqual(first.system)
  })

  test("#given a model switch #then the system output changes deterministically", async () => {
    const handler = createSystemTransformHandler({ ultrawork: true }, getUltraworkMessage)

    const gpt = { system: ["base system prompt"] }
    await handler(
      { sessionID: SESSION, model: { id: "gpt-5.5", providerID: "openai" } },
      gpt,
    )
    const gemini = { system: ["base system prompt"] }
    await handler(
      { sessionID: SESSION, model: { id: "gemini-3.1-pro", providerID: "google" } },
      gemini,
    )
    const gptAgain = { system: ["base system prompt"] }
    await handler(
      { sessionID: SESSION, model: { id: "gpt-5.5", providerID: "openai" } },
      gptAgain,
    )

    expect(gemini.system).not.toEqual(gpt.system)
    expect(gptAgain.system).toEqual(gpt.system)
  })
})
