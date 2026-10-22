// The launcher sets HERDR_AGENT for the interactive engine so herdr can prompt its pane (#10448;
// omo-native bin/lib/herdr-agent-hint.js), and records the value it wrote in OMO_HERDR_AGENT_HINT.
// herdr reads the hint from the engine process's exec'd environment, which this does not change;
// removing it here keeps every process the engine starts (shell commands, an external editor,
// child engines) from inheriting it, as herdr asks: the hint applies only to the one foreground
// process it was set for. Only a hint the launcher set is removed; a HERDR_AGENT the user set
// themselves stays exactly as they set it.
const HERDR_AGENT_MARKER = "OMO_HERDR_AGENT_HINT"

export function releaseHerdrAgentHint(env: NodeJS.ProcessEnv = process.env): void {
  const written = env[HERDR_AGENT_MARKER]
  delete env[HERDR_AGENT_MARKER]
  if (written !== undefined && env.HERDR_AGENT === written) delete env.HERDR_AGENT
}
