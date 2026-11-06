import { isEngineCommand } from "./engine-commands.js"

const FLAG = "--mcp-presenter-enforcement"

// RPC hosts that omo launches enforce presenter accounts (D11 M-1). The interactive session joins once the engine's
// terminal presenter path ships (senpi#5777); engine subcommands and caller-owned children (`--no-extensions`) keep
// their argv.
export function withPresenterEnforcement(args) {
  const end = args.indexOf("--")
  const options = end < 0 ? args : args.slice(0, end)
  const rpcHost = options.some((arg, index) => arg === "--mode" && options[index + 1] === "rpc")
  if (!rpcHost || isEngineCommand(args) || options.includes(FLAG) || options.includes("--no-extensions")) return args
  return [FLAG, ...args]
}
