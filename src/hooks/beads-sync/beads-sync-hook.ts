import type { PluginInput } from "@opencode-ai/plugin"
import type { BeadsConfig } from "../../config"
import { log } from "../../shared/logger"
import { existsSync } from "node:fs"
import { join } from "node:path"

export const HOOK_NAME = "beads-sync" as const

export interface BeadsSyncHookOptions {
  config: BeadsConfig
  ctx: PluginInput
}

async function initBeads(ctx: PluginInput, config: BeadsConfig): Promise<void> {
  const { spawn } = await import("bun")
  const baseCommand = config.beads_command ?? "bd"
  const cmd = `${baseCommand} init --quiet`

  const [cli, ...args] = cmd.split(" ")
  const proc = spawn([cli, ...args], {
    cwd: ctx.directory,
    stdout: "pipe",
    stderr: "pipe",
  })

  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited

  if (exitCode !== 0) {
    throw new Error(`Beads init failed (exit code ${exitCode}): ${stderr}`)
  }
}

async function syncBeads(ctx: PluginInput, config: BeadsConfig): Promise<void> {
  const { spawn } = await import("bun")
  const baseCommand = config.beads_command ?? "bd"
  const cmd = `${baseCommand} sync`

  const [cli, ...args] = cmd.split(" ")
  const proc = spawn([cli, ...args], {
    cwd: ctx.directory,
    stdout: "pipe",
    stderr: "pipe",
  })

  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited

  if (exitCode !== 0) {
    throw new Error(`Beads sync failed (exit code ${exitCode}): ${stderr}`)
  }
}

export function createBeadsSyncHook(options: BeadsSyncHookOptions) {
  const { config, ctx } = options

  return {
    event: async (input: { event: { type: string; properties?: Record<string, unknown> } }): Promise<void> => {
      const eventType = input.event.type

      if (eventType === "session.created") {
        if (!config.enabled) {
          log(`[${HOOK_NAME}] Beads integration disabled, skipping auto-init`)
          return
        }

        if (!config.auto_init) {
          log(`[${HOOK_NAME}] Auto-init disabled, skipping`)
          return
        }

        const beadsDir = join(ctx.directory, ".beads")

        if (existsSync(beadsDir)) {
          log(`[${HOOK_NAME}] .beads directory already exists, skipping init`)
          return
        }

        try {
          log(`[${HOOK_NAME}] Initializing beads...`)
          await initBeads(ctx, config)
          log(`[${HOOK_NAME}] Beads initialized successfully`)
        } catch (e) {
          log(`[${HOOK_NAME}] Failed to initialize beads`, { error: e instanceof Error ? e.message : String(e) })
        }
      }

      if (eventType === "session.idle") {
        if (!config.enabled) {
          log(`[${HOOK_NAME}] Beads integration disabled, skipping sync`)
          return
        }

        if (!config.sync_on_idle) {
          log(`[${HOOK_NAME}] Sync on idle disabled, skipping`)
          return
        }

        try {
          log(`[${HOOK_NAME}] Syncing beads...`)
          await syncBeads(ctx, config)
          log(`[${HOOK_NAME}] Beads synced successfully`)
        } catch (e) {
          log(`[${HOOK_NAME}] Failed to sync beads`, { error: e instanceof Error ? e.message : String(e) })
        }
      }
    },
  }
}
