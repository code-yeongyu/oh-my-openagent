#!/usr/bin/env bun

const BASE_URL = "https://api.llmgateway.io/v1"

interface LlmModel {
  id: string
  name: string
}

interface LlmModelsResponse {
  data: LlmModel[]
}

interface ProviderConfig {
  provider: {
    "llmgateway-secondary": {
      npm: string
      name: string
      options: {
        baseURL: string
        apiKey: string
      }
      models: Record<string, Record<string, never>>
    }
  }
}

export async function generateProviderConfig(apiKey: string): Promise<ProviderConfig> {
  const response = await fetch(`${BASE_URL}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })

  if (!response.ok) {
    throw new Error(`LLM Gateway API returned ${response.status}: ${await response.text()}`)
  }

  const body = (await response.json()) as LlmModelsResponse

  const models: Record<string, Record<string, never>> = {}
  for (const model of body.data) {
    models[model.id] = {}
  }

  const sortedModels: Record<string, Record<string, never>> = {}
  for (const id of Object.keys(models).sort()) {
    sortedModels[id] = models[id]
  }

  return {
    provider: {
      "llmgateway-secondary": {
        npm: "@ai-sdk/openai-compatible",
        name: "LLM Gateway (secondary)",
        options: {
          baseURL: BASE_URL,
          apiKey,
        },
        models: sortedModels,
      },
    },
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.LLMGATEWAY_API_KEY
  if (!apiKey) {
    console.error("Error: LLMGATEWAY_API_KEY environment variable is required")
    process.exit(1)
  }

  try {
    const config = await generateProviderConfig(apiKey)
    console.log(JSON.stringify(config))
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

if (import.meta.main) {
  main()
}
