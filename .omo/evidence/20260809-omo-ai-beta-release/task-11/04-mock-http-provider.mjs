#!/usr/bin/env node
const model = {
  id: "mock-1",
  name: "Task 11 HTTP Mock",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 4096,
}

export default function registerTask11MockProvider(pi) {
  const baseUrl = process.env.OMO_TASK11_MOCK_BASE_URL
  if (!baseUrl) throw new Error("OMO_TASK11_MOCK_BASE_URL is required")
  pi.registerProvider("omo-task11-http", {
    name: "Task 11 HTTP Mock",
    baseUrl: `${baseUrl}/v1`,
    apiKey: "mock",
    api: "openai-completions",
    models: [model],
  })
}
