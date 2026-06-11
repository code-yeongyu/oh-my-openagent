import { createInterface } from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import { createAgent } from "./agent"
import { defaultTools } from "./tools"

class MissingOpenRouterApiKeyError extends Error {
  readonly name = "MissingOpenRouterApiKeyError"

  constructor() {
    super("OPENROUTER_API_KEY is required")
  }
}

export async function main(): Promise<void> {
  const apiKey = process.env["OPENROUTER_API_KEY"]
  if (apiKey === undefined || apiKey.length === 0) {
    throw new MissingOpenRouterApiKeyError()
  }

  const agent = createAgent({
    apiKey,
    model: process.env["OPENROUTER_MODEL"] ?? "openrouter/auto",
    instructions: "You are a concise assistant with access to tools.",
    tools: defaultTools,
  })

  agent.on("thinking:start", () => output.write("\nThinking...\n"))
  agent.on("tool:call", (name, args) => output.write(`\nUsing ${name}: ${JSON.stringify(args)}\n`))
  agent.on("stream:delta", (delta) => output.write(delta))
  agent.on("stream:end", () => output.write("\n\n"))
  agent.on("error", (error) => output.write(`Error: ${error.message}\n`))

  const rl = createInterface({ input, output })
  output.write("OpenRouter agent ready. Type a message, or /exit to quit.\n\n")

  while (true) {
    const answer = await rl.question("You: ")
    const message = answer.trim()
    if (message === "/exit") {
      rl.close()
      return
    }
    if (message.length === 0) {
      continue
    }
    await agent.send(message)
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    if (error instanceof Error) {
      output.write(`${error.name}: ${error.message}\n`)
      process.exit(1)
    }
    throw error
  })
}
