import { describe, expect, test } from "bun:test"

import {
  buildModelCapabilitiesSnapshotFromModelsDev,
  fetchModelCapabilitiesSnapshot,
} from "./model-capabilities-snapshot"

describe("model-capabilities-snapshot", () => {
  test("builds a normalized snapshot from models.dev provider data", () => {
    const raw = {
      openai: {
        models: {
          "gpt-5.4": {
            id: "gpt-5.4",
            family: "gpt",
            reasoning: true,
            temperature: false,
            tool_call: true,
            modalities: {
              input: ["text", "image"],
              output: ["text"],
            },
            limit: {
              context: 1_050_000,
              output: 128_000,
            },
          },
        },
      },
    }

    const snapshot = buildModelCapabilitiesSnapshotFromModelsDev(raw)

    expect(snapshot.sourceUrl).toBe("https://models.dev/api.json")
    expect(snapshot.models["gpt-5.4"]).toEqual({
      id: "gpt-5.4",
      family: "gpt",
      reasoning: true,
      temperature: false,
      toolCall: true,
      modalities: {
        input: ["text", "image"],
        output: ["text"],
      },
      limit: {
        context: 1_050_000,
        output: 128_000,
      },
    })
  })

  test("ignores malformed provider entries and missing fields", () => {
    const raw = {
      invalidProvider: null,
      anthropic: {
        models: {
          "claude-sonnet-4-6": {
            reasoning: true,
          },
          "bad-model": "invalid",
        },
      },
      openai: {
        models: {
          "gpt-5.4": {
            id: "GPT-5.4",
            modalities: {
              input: ["text", 1],
            },
          },
        },
      },
    }

    const snapshot = buildModelCapabilitiesSnapshotFromModelsDev(raw)

    expect(snapshot.models["claude-sonnet-4-6"]).toEqual({
      id: "claude-sonnet-4-6",
      reasoning: true,
    })
    expect(snapshot.models["gpt-5.4"]).toEqual({
      id: "GPT-5.4",
      modalities: {
        input: ["text"],
      },
    })
    expect(snapshot.models["bad-model"]).toBeUndefined()
  })

  test("fetches snapshot using injected fetch implementation", async () => {
    const sourceUrl = "https://fixture.local/models.json"
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          openai: {
            models: {
              "gpt-5.4": {
                id: "gpt-5.4",
                limit: {
                  output: 128_000,
                },
              },
            },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )

    const snapshot = await fetchModelCapabilitiesSnapshot({ sourceUrl, fetchImpl })

    expect(snapshot.sourceUrl).toBe(sourceUrl)
    expect(snapshot.models["gpt-5.4"]?.limit?.output).toBe(128_000)
  })
})
