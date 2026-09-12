import { readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"
import { z } from "zod"

import { LSP_STATUS_FILE_NAME, LSP_STATUS_SCHEMA_VERSION, LSP_STATUS_STALE_MS } from "./constants"
import type { LspClientRow } from "./state-types"

const LspDaemonClientSchema = z.object({
  serverId: z.string(),
  root: z.string(),
  alive: z.boolean(),
  isInitializing: z.boolean(),
  refCount: z.number(),
})

const LspDaemonStatusSchema = z.object({
  version: z.literal(LSP_STATUS_SCHEMA_VERSION),
  updatedAt: z.number(),
  pid: z.number(),
  clients: z.array(LspDaemonClientSchema),
})

export function readLspDaemonStatus(env: NodeJS.ProcessEnv = process.env): readonly LspClientRow[] {
  const override = env["OMO_LSP_DAEMON_DIR"]
  const baseDir = override !== undefined && isAbsolute(override) ? override : join(homedir(), ".omo", "lsp-daemon")
  try {
    const entries = readdirSync(baseDir, { withFileTypes: true })
    let freshest: z.infer<typeof LspDaemonStatusSchema> | null = null
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith("v")) {
        continue
      }
      try {
        const raw = JSON.parse(readFileSync(join(baseDir, entry.name, LSP_STATUS_FILE_NAME), "utf8"))
        const parsed = LspDaemonStatusSchema.safeParse(raw)
        if (!parsed.success || Date.now() - parsed.data.updatedAt > LSP_STATUS_STALE_MS) {
          continue
        }
        if (freshest === null || parsed.data.updatedAt > freshest.updatedAt) {
          freshest = parsed.data
        }
      } catch (error) {
        if (error instanceof Error) {
          continue
        }
        throw error
      }
    }
    return freshest?.clients.map((client) => ({
      serverId: client.serverId,
      root: client.root,
      state: client.alive ? (client.isInitializing ? "initializing" : "alive") : "dead",
      refCount: client.refCount,
    })) ?? []
  } catch (error) {
    if (error instanceof Error) {
      return []
    }
    throw error
  }
}
