import type { V2PluginContext } from "../context-types"
import { applyDesiredAgents } from "./apply-agents"
import { applyDesiredCommands } from "./apply-commands"
import { applyDesiredMcp } from "./apply-mcp"
import type { BeforeCommandHook } from "./create-command-executor"
import { EMPTY_DESIRED_CONFIG, readDesiredConfig, type DesiredConfig } from "./desired-config"
import { buildConfigSnapshot } from "./snapshot"

export type ConfigHook = (config: Record<string, unknown>) => Promise<void>

export type ConfigBridgeDeps = {
  readonly warn: (message: string) => void
  /** Quiet period before a host change triggers a re-run; coalesces bursts of events. */
  readonly debounceMs?: number
  /** The plugin's 1.x `command.execute.before` hook; run for every command the bridge registers. */
  readonly beforeCommand?: BeforeCommandHook
}

/** Host events after which provider, model or config data the hook depends on may have changed. */
const REFRESH_EVENTS: ReadonlySet<string> = new Set([
  "provider.updated",
  "model.updated",
  "config.updated",
  "integration.updated",
  "credential.updated",
])

/**
 * Runs the plugin's 1.x `config` hook against a snapshot built from 2.x state and applies the result
 * to the 2.x agent, MCP and command registries.
 *
 * Host state is not final when a plugin's setup runs (providers from config arrive afterwards), so
 * the hook runs once at install and again after the events above. A run whose output equals the
 * previous one does nothing, which is also what keeps the host's own reload events from looping.
 */
export async function installConfigBridge(
  context: V2PluginContext,
  configHook: ConfigHook,
  deps: ConfigBridgeDeps,
): Promise<() => Promise<void>> {
  let desired: DesiredConfig = EMPTY_DESIRED_CONFIG
  let appliedKey = ""
  const agentRegistration = await context.agent.transform((editor) => applyDesiredAgents(editor, desired))
  const mcpRegistration = await context.mcp.transform((editor) => applyDesiredMcp(editor, desired))
  const commandRegistration = await context.command.transform((editor) =>
    applyDesiredCommands(editor, desired, { session: context.session, agents: context.agent, beforeHook: deps.beforeCommand }),
  )
  const warned = new Set<string>()
  const warnOnce = (message: string): void => {
    if (warned.has(message)) return
    warned.add(message)
    deps.warn(message)
  }

  const runOnce = async (): Promise<void> => {
    try {
      const snapshot = await buildConfigSnapshot(context)
      await configHook(snapshot)
      const next = readDesiredConfig(snapshot)
      const key = JSON.stringify(next)
      if (key === appliedKey) return
      desired = next
      appliedKey = key
      for (const name of next.skippedMcp) warnOnce(`Skipping MCP server "${name}": 2.x cannot represent this entry`)
      for (const name of next.skippedCommands) warnOnce(`Skipping command "${name}": it has no template`)
      await context.agent.reload()
      await context.mcp.reload()
      await context.command.reload()
    } catch (error) {
      deps.warn(`config hook failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  let queue: Promise<void> = Promise.resolve()
  const refresh = (): Promise<void> => (queue = queue.then(runOnce))

  await refresh()

  const abort = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => void refresh(), deps.debounceMs ?? 250)
  }
  void (async () => {
    try {
      for await (const event of context.event.subscribe({ signal: abort.signal })) {
        if (REFRESH_EVENTS.has(event.type)) schedule()
      }
    } catch (error) {
      if (!abort.signal.aborted) deps.warn(`event subscription failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  })()

  return async () => {
    abort.abort()
    clearTimeout(timer)
    await commandRegistration.dispose()
    await mcpRegistration.dispose()
    await agentRegistration.dispose()
  }
}
