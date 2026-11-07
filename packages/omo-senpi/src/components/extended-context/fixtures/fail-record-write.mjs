import { mock } from "bun:test"
import { join } from "node:path"

const agentDir = process.argv[2]
if (!agentDir) throw new Error("A fixture agent directory is required")
const record = join(agentDir, "extended-context.json")
const utils = await import("@oh-my-opencode/utils")
const writeFileAtomically = utils.writeFileAtomically

mock.module("@oh-my-opencode/utils", () => ({
  ...utils,
  writeFileAtomically(path, content, options) {
    if (path === record) throw new Error("fixture-record-write-failure")
    writeFileAtomically(path, content, options)
  },
}))

const { registerExtendedContextCommand } = await import("../index.ts")
let handler
registerExtendedContextCommand(
  { registerCommand(_name, options) { handler = options.handler } },
  {
    hostVersion: "fixture",
    fetchImpl: async () => Response.json({ models: [{ slug: "fixture-model", max_context_window: 872_000 }] }),
  },
)
if (!handler) throw new Error("The command was not registered")
const result = await handler("on", {
  agentDir,
  modelRegistry: {
    getAll: () => [{ id: "fixture-model", provider: "chatgpt-subscription", contextWindow: 500_000, maxTokens: 128_000 }],
    getApiKeyForProvider: () => "fixture",
  },
})
if (!result.includes("fixture-record-write-failure")) throw new Error("The record write did not fail")
