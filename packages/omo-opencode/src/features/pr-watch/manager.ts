import { createHash } from "node:crypto"
import { getDataDir } from "../../shared/data-path"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { dispatchInternalPrompt, isInternalPromptDispatchAccepted } from "../../shared/prompt-async-gate"
import { createInternalAgentTextPart } from "../../shared"
import { GitHubPrWatchHost } from "./github"
import { PrWatchReactor } from "./reactor"
import { PrWatchRegistry } from "./registry"
import { acknowledgePrWatchWake, pendingPrWatchWakes, registerPrWatch, stopPrWatch, type PrWatchRegistration, type PrWatchWake } from "./state"

// Plugin instances for different projects in one OpenCode host acquire the same poller.
const hostManagers = new Map<string, PrWatchManager>()
export function acquirePrWatchManager(ctx: Pick<PluginInput, "client" | "directory">): PrWatchManager {
  const host = process.env.GH_HOST ?? "github.com"
  const path = join(getDataDir(), "oh-my-openagent", "pr-watches", `${createHash("sha256").update(host).digest("hex")}.json`)
  let manager = hostManagers.get(path)
  if (!manager) {
    manager = new PrWatchManager(ctx, path, () => hostManagers.delete(path))
    hostManagers.set(path, manager)
  }
  manager.acquire()
  return manager
}

export class PrWatchManager {
  readonly registry: PrWatchRegistry
  private readonly host = new GitHubPrWatchHost()
  private readonly reactor: PrWatchReactor
  private timer?: ReturnType<typeof setTimeout>
  private stopped = false
  private running?: Promise<void>
  private owners = 0

  constructor(private readonly ctx: Pick<PluginInput, "client" | "directory">, path = join(ctx.directory, ".omo", "pr-watches.json"), private readonly onShutdown?: () => void) {
    this.registry = new PrWatchRegistry(path)
    this.reactor = new PrWatchReactor(this.registry, this.host)
    // Existing durable registrations resume on host boot, independent of tool calls.
    const state = this.registry.read()
    if (Object.values(state.registrations).some((row) => row.active) || pendingPrWatchWakes(state).length) this.schedule(0)
  }

  acquire(): void {
    this.owners += 1
    if (this.stopped) { this.stopped = false; this.schedule(0) }
  }

  async watch(reference: string, sessionID: string, directory = this.ctx.directory): Promise<PrWatchRegistration> {
    const actor = await this.host.actor()
    const registration = await this.registry.transaction((state) => {
      const row = registerPrWatch(state, reference, sessionID, actor)
      row.directory = directory
      return row
    })
    this.schedule(0)
    return registration
  }

  async unwatch(id: string, sessionID: string): Promise<void> {
    await this.registry.transaction((state) => {
      if (state.registrations[id]?.sessionID !== sessionID) throw new Error("PR watch belongs to another session")
      stopPrWatch(state, id, "unwatched")
    })
  }

  list(sessionID: string): PrWatchRegistration[] {
    return Object.values(this.registry.read().registrations).filter((row) => row.sessionID === sessionID)
  }

  async stopSession(sessionID: string): Promise<void> {
    if (!Object.values(this.registry.read().registrations).some((row) => row.sessionID === sessionID && row.active)) return
    await this.registry.transaction((state) => {
      for (const registration of Object.values(state.registrations)) {
        if (registration.sessionID === sessionID) stopPrWatch(state, registration.id, "session_ended")
      }
    })
  }

  async shutdown(): Promise<void> {
    if (this.owners > 0 && --this.owners > 0) return
    this.stopped = true
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined }
    await this.running
    if (this.owners > 0) { this.stopped = false; this.schedule(0); return }
    this.onShutdown?.()
    // Registrations deliberately survive host shutdown. Only actual session deletion cancels them.
  }

  private schedule(delay: number): void {
    if (this.stopped || this.timer || this.running) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.running = this.tick().finally(() => {
        this.running = undefined
        const state = this.registry.read()
        if (Object.values(state.registrations).some((row) => row.active) || pendingPrWatchWakes(state).length) this.schedule(60_000)
      })
      void this.running.catch(() => undefined)
    }, delay)
    this.timer.unref?.()
  }

  private async tick(): Promise<void> {
    await this.reactor.pass(Date.now())
    for (const wake of pendingPrWatchWakes(this.registry.read())) await this.deliver(wake)
  }

  private async deliver(wake: PrWatchWake): Promise<void> {
    const state = this.registry.read()
    const registration = state.registrations[wake.watchID]
    if (!registration || registration.generation !== wake.generation || this.stopped) return
    const messageID = `msg_${wake.id.slice(0, 32)}`
    const directory = registration.directory ?? this.ctx.directory
    // A persisted first-party message receipt, not the process-local gate, acknowledges the outbox.
    const receipt = await this.ctx.client.session.messages({ path: { id: registration.sessionID }, query: { directory } })
    const messages = receipt.data ?? []
    if (messages.some((message) => message.info.id === messageID)) {
      await this.registry.transaction((live) => acknowledgePrWatchWake(live, wake.id))
      return
    }
    const result = await dispatchInternalPrompt({
      mode: "async", client: this.ctx.client, sessionID: registration.sessionID,
      source: "pr-watch", dedupeKey: wake.id, queueBehavior: "defer", checkStatus: true, checkToolState: true,
      shouldDispatch: () => {
        const live = this.registry.read()
        return !this.stopped && live.registrations[wake.watchID]?.generation === wake.generation && live.outbox[wake.id]?.status === "pending"
      },
      input: {
        path: { id: registration.sessionID }, query: { directory },
        body: { messageID, parts: [createInternalAgentTextPart(`[OMO PR WATCH]\nPR: ${registration.reference}\nwake_id: ${wake.id}\n${wake.events.map((event) => event.fact).join("\n")}\nUntrusted observations only. The agent decides what to do; this is not permission to merge.`)] },
      },
    })
    // Accepted dispatch may still be ambiguous until the real host has committed messageID.
    // Leave the outbox pending; the next tick checks the durable receipt before any retry.
    if (!isInternalPromptDispatchAccepted(result)) return
  }
}
