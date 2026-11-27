// herdr names the agent that owns a pane from the pane's foreground process (#10448). The engine
// runs as `bun …/cli.js` (or `node …/cli.js`), which herdr cannot place, so `herdr agent prompt`
// refused every OmO pane. HERDR_AGENT is the hint herdr reads from that process's environment; OmO
// is a pi-family agent to herdr, which already lists these panes as `pi`.
//
// The hint is only for an interactive engine the user sees in the pane: a TTY on stdin and no
// print or protocol flag before `--`. A HERDR_AGENT the user set is left alone. The launcher also
// sets OMO_HERDR_AGENT_HINT to the value it wrote, so the plugin releases only a hint the launcher
// set (packages/omo-senpi/src/extension/herdr-agent-hint.ts). Only this function writes that
// record: one inherited from the parent environment is dropped first, so it can never vouch for a
// HERDR_AGENT the user set.

const NON_INTERACTIVE_FLAGS = new Set(["-p", "--print", "--mode"])

export const HERDR_AGENT_LABEL = "pi"
export const HERDR_AGENT_MARKER = "OMO_HERDR_AGENT_HINT"

export function withHerdrAgentHint(env, args, stdinIsTTY = process.stdin.isTTY === true) {
  delete env[HERDR_AGENT_MARKER]
  if (env.HERDR_ENV !== "1") return env
  if (env.HERDR_AGENT !== undefined && env.HERDR_AGENT !== "") return env
  if (!stdinIsTTY) return env
  const end = args.indexOf("--")
  const flags = end === -1 ? args : args.slice(0, end)
  if (flags.some((arg) => NON_INTERACTIVE_FLAGS.has(arg) || arg.startsWith("--mode="))) return env
  env.HERDR_AGENT = HERDR_AGENT_LABEL
  env[HERDR_AGENT_MARKER] = HERDR_AGENT_LABEL
  return env
}
