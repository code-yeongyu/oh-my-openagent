import { isEngineCommand } from "./engine-commands.js"

const FLAG = "--mcp-presenter-enforcement"

// Hosts and the interactive session that omo launches enforce presenter accounts (D11 M-1). Engine subcommands,
// one-shot runs and caller-owned children (`--no-extensions`) serve no presenter, so they keep their argv.
export function withPresenterEnforcement(args) {
  const end = args.indexOf("--")
  const options = end < 0 ? args : args.slice(0, end)
  if (isEngineCommand(args) || options.includes(FLAG) || options.includes("--no-extensions")
    || options.includes("-p") || options.includes("--print")
    || options.some((arg, index) => arg === "--mode" && options[index + 1] === "json")) return args
  return [FLAG, ...args]
}
