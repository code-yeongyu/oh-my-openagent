// How an omo config edit takes effect differs by the surface the session runs in, and the model has
// no other way to know which one that is (#10021). Without this it suggests the terminal UI's
// /reload in the desktop app, where no slash command exists.

type ConfigApplySurface = "terminal-ui" | "app" | "rpc-client" | "one-shot"

const HEADING = "## Applying omo config changes"

// senpi's config-reload watch (fed by this component's registration) reloads the session once it is
// idle; the task reload guard vetoes that reload while a subagent or DAG run is still in flight.
const HOT_RELOAD =
  "Saved edits to omo config (omo.json / omo.jsonc: categories, agents, model profiles) hot-reload by themselves once this session is idle with no subagent or DAG run in flight. Tasks started with the `task` tool after that reload use the new settings; a task already running keeps the model it started with."

const NO_TERMINAL_COMMANDS =
  "has no slash commands and no terminal keyboard shortcuts, so never tell the user to type a command or press a key from the senpi terminal UI."

function resolveSurface(mode: unknown, promptSurface: unknown): ConfigApplySurface | undefined {
  switch (mode) {
    case "tui":
      return "terminal-ui"
    case "rpc":
      return promptSurface === "app" || promptSurface === "chat" ? "app" : "rpc-client"
    case "print":
    case "json":
      return "one-shot"
    default:
      return undefined
  }
}

function guidance(surface: ConfigApplySurface): string {
  switch (surface) {
    case "terminal-ui":
      return `This session runs in the senpi terminal UI. ${HOT_RELOAD} To apply a change sooner, the user can run /reload.`
    case "app":
      return `This session runs in the OmO app, which ${NO_TERMINAL_COMMANDS} ${HOT_RELOAD} The user needs no other step; the app's "Reload runtime settings" control only re-reads the values it displays. To use a changed per-task model, start a new task (or a new thread) after the reload instead of resuming one that already ran.`
    case "rpc-client":
      return `This session is driven by an RPC client, which ${NO_TERMINAL_COMMANDS} ${HOT_RELOAD} A client that needs the change at once opens a new session.`
    case "one-shot":
      return `This is a one-shot run, which ${NO_TERMINAL_COMMANDS} It reads omo config once when it starts, so a config change applies to the next run.`
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function appendConfigApplyGuidance(payload: unknown, eventCtx: unknown): { systemPrompt: string } | undefined {
  if (!isRecord(payload) || payload.type !== "before_agent_start") return undefined
  const systemPrompt = payload.systemPrompt
  if (typeof systemPrompt !== "string" || systemPrompt.includes(HEADING)) return undefined
  const options = payload.systemPromptOptions
  const surface = resolveSurface(
    isRecord(eventCtx) ? eventCtx.mode : undefined,
    isRecord(options) ? options.surface : undefined,
  )
  if (surface === undefined) return undefined
  return { systemPrompt: `${systemPrompt}\n\n${HEADING}\n\n${guidance(surface)}` }
}
