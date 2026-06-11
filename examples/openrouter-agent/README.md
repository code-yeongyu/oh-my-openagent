# OpenRouter Agent Example

A modular OpenRouter agent with a hookable lifecycle (thinking, tool calls, streaming) built on `@openrouter/agent` and `@openrouter/sdk`.

## Setup

```bash
bun install
cp .env.example .env   # then fill in OPENROUTER_API_KEY
```

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `OPENROUTER_API_KEY` | yes | — | Your OpenRouter API key |
| `OPENROUTER_MODEL` | no | `openrouter/auto` | Model slug to route to |

## Run

```bash
bun run src/headless.ts   # interactive REPL; type a message, /exit to quit
```

## Test & typecheck

```bash
bun test
bun run typecheck
```

## Programmatic use

```ts
import { createAgent, defaultTools } from "./src"

const agent = createAgent({
  apiKey: process.env.OPENROUTER_API_KEY!,
  tools: defaultTools,
})

agent.on("stream:delta", (delta) => process.stdout.write(delta))
await agent.send("What time is it?")
```
