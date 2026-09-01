// Integration driver for #6338 / PR #6485.
//
// Executes the REAL `chat.params` handler (packages/omo-opencode/src/plugin/chat-params.ts)
// against the reporter's exact scenario: an agent pinned to a Claude Opus 4.8 model served by
// a custom provider that is absent from every capability catalog, with `temperature` set.
//
// `chat.params` is the boundary where OpenCode hands the plugin the outgoing request
// parameters, so what this driver observes is what the provider would receive.
import { createChatParamsHandler } from "../../../packages/omo-opencode/src/plugin/chat-params"

type Scenario = {
  label: string
  providerID: string
  modelID: string
}

const scenarios: Scenario[] = [
  { label: "reported case: custom provider hosting Opus 4.8", providerID: "azure-anthropic", modelID: "claude-opus-4-8" },
  { label: "same family, reasoning suffix", providerID: "azure-anthropic", modelID: "claude-opus-4-8-thinking" },
  { label: "first-party Anthropic Opus 4.8", providerID: "anthropic", modelID: "claude-opus-4-8" },
  { label: "control: model that supports temperature", providerID: "openai", modelID: "gpt-4o" },
]

const handler = createChatParamsHandler({})

let failures = 0

for (const scenario of scenarios) {
  const input = {
    sessionID: "ses_live_6338",
    agent: { name: "oracle" },
    model: { providerID: scenario.providerID, modelID: scenario.modelID },
    provider: { id: scenario.providerID },
    message: {},
  }
  const output: Record<string, unknown> = {
    temperature: 0.1,
    topP: 0.9,
    maxOutputTokens: 32000,
    options: {},
  }

  await handler(input, output)

  const temperatureSent = "temperature" in output
  const topPSent = "topP" in output
  console.log(
    `${scenario.providerID}/${scenario.modelID}\n` +
      `    ${scenario.label}\n` +
      `    temperature_sent=${temperatureSent}${temperatureSent ? ` (${String(output.temperature)})` : ""}` +
      ` topP_sent=${topPSent}\n` +
      `    resulting_keys=${Object.keys(output).sort().join(",")}`,
  )

  const isOpus48 = scenario.modelID.startsWith("claude-opus-4-8")
  const expectedTemperature = !isOpus48
  if (temperatureSent !== expectedTemperature) {
    console.log(`    ^^ MISMATCH: expected temperature_sent=${expectedTemperature}`)
    failures += 1
  }
}

console.log("")
console.log(`RESULT: ${failures === 0 ? "all scenarios behave as expected" : `${failures} scenario(s) mismatched`}`)
process.exit(failures === 0 ? 0 : 1)
