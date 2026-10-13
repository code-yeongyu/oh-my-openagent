import type { V2PluginContext } from "../context-types"
import { applyDesiredAgents } from "./apply-agents"
import { applyDesiredMcp } from "./apply-mcp"
import { EMPTY_DESIRED_CONFIG, readDesiredConfig, type DesiredConfig } from "./desired-config"
import { buildConfigSnapshot } from "./snapshot"

export type ConfigHook = (config: Record<string, unknown>) => Promise<void>

export type ConfigBridgeDeps = {
  readonly warn: (message: string) => void
  /** Quiet period before a host change triggers a re-run; coalesces bursts of events. */
  readonly debounceMs?: number
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
 * to the 2.x agent and MCP registries.
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
  const warnedMcp = new Set<string>()

  const runOnce = async (): Promise<void> => {
    try {
      const snapshot = await buildConfigSnapshot(context)
      await configHook(snapshot)
      const next = readDesiredConfig(snapshot)
      const key = JSON.stringify(next)
      if (key === appliedKey) return
      desired = next
      appliedKey = key
      for (const name of next.skippedMcp) {
        if (warnedMcp.has(name)) continue
        warnedMcp.add(name)
        deps.warn(`Skipping MCP server "${name}": 2.x cannot represent this entry`)
      }
      await context.agent.reload()
      await context.mcp.reload()
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
    await mcpRegistration.dispose()
    await agentRegistration.dispose()
  }
}
