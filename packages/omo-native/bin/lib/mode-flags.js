// The engine's protocol modes (senpi#5840). `--hand` serves tool calls for a loop that runs elsewhere and `--headless`
// serves sessions over the engine's own socket. Nobody reads their terminal, so the launcher prints no banner or setup
// hint and names no herdr agent for them; they still start with omo's extension, agent dir and launch spec, like any
// chat launch. A flag after `--` is prompt text, not a mode.
export const ENGINE_PROTOCOL_MODE_FLAGS = Object.freeze(["--hand", "--headless"])

/** @param {readonly string[]} args */
export function isEngineProtocolMode(args) {
  const end = args.indexOf("--")
  const flags = end === -1 ? args : args.slice(0, end)
  return flags.some((arg) => ENGINE_PROTOCOL_MODE_FLAGS.includes(arg))
}
